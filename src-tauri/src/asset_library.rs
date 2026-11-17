use percent_encoding::percent_decode_str;
use std::{fs, io::Write, path::{Component, Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::Duration};
use tauri::{http::Response, Manager};

const DEFAULT_ASSET_LIBRARY_DIRECTORY: &str = r"F:\Neowiz\Brown-Dust-2-Asset-master";
static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct AssetLibrary {
    root: Mutex<Option<PathBuf>>,
}

impl AssetLibrary {
    pub fn root(&self) -> Option<PathBuf> { self.root.lock().ok().and_then(|root| root.clone()) }
    fn set_root(&self, directory: &str) -> Result<(), String> {
        let result = validate_root(directory);
        let mut current = self.root.lock().map_err(|e| e.to_string())?;
        match result {
            Ok(root) => { *current = root; Ok(()) },
            Err(error) => { *current = None; Err(error) },
        }
    }
    pub fn file(&self, relative: &str) -> Option<PathBuf> {
        let root = self.root()?;
        let path = fs::canonicalize(root.join(relative)).ok()?;
        (path.starts_with(&root) && path.is_file()).then_some(path)
    }
}

fn validate_root(directory: &str) -> Result<Option<PathBuf>, String> {
    if directory.trim().is_empty() { return Ok(None); }
    let path = Path::new(directory.trim());
    if !path.is_absolute() { return Err("Choose an absolute asset library folder".into()); }
    fs::create_dir_all(path).map_err(|e| format!("Could not create asset library: {e}"))?;
    let root = fs::canonicalize(path).map_err(|e| format!("Could not open asset library: {e}"))?;
    if !root.is_dir() { return Err("Choose an asset library folder".into()); }
    Ok(Some(root))
}

#[tauri::command]
pub fn set_asset_library_root(state: tauri::State<AssetLibrary>, directory: String) -> Result<(), String> {
    state.set_root(&directory)
}

#[tauri::command]
pub fn get_asset_library_root(state: tauri::State<AssetLibrary>) -> Option<String> {
    state.root().map(|path| path.to_string_lossy().into_owned())
}

pub fn load_shared_asset_library_root(app: &tauri::AppHandle) {
    let fallback = || PathBuf::from(DEFAULT_ASSET_LIBRARY_DIRECTORY);
    let root = app.path().app_data_dir().ok()
        .and_then(|app_data| app_data.parent().map(Path::to_path_buf))
        .map(|parent| parent.join("LLsetnow").join("BD2AssetLibrary").join("root.txt"))
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|root| root.trim().to_string())
        .filter(|root| !root.is_empty())
        .unwrap_or_else(|| fallback().to_string_lossy().into_owned());
    let _ = app.state::<AssetLibrary>().set_root(&root);
}

fn relative_path(encoded: &str) -> Result<String, String> {
    let path = percent_decode_str(encoded).decode_utf8().map_err(|_| "Invalid asset path")?;
    let path = path.trim_start_matches('/');
    if path.is_empty() || path.contains('\\') || path.contains(':')
        || !Path::new(path).components().all(|part| matches!(part, Component::Normal(_)))
        || !["spine/", "ui/", "audio/", "backgrounds/"].iter().any(|prefix| path.starts_with(prefix)) {
        return Err("Invalid asset path".into());
    }
    Ok(path.into())
}

fn mime(path: &str) -> Option<&'static str> {
    match Path::new(path).extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"), "json" => Some("application/json"),
        "atlas" => Some("text/plain"), "skel" => Some("application/octet-stream"),
        "ogg" => Some("audio/ogg"), "mp3" => Some("audio/mpeg"), "wav" => Some("audio/wav"),
        _ => None,
    }
}

fn read_local(root: &Path, relative: &str) -> Result<Option<Vec<u8>>, String> {
    let path = match fs::canonicalize(root.join(relative)) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !path.starts_with(root) || !path.is_file() { return Err("Asset is outside the selected library".into()); }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 { return Err("Asset is too large".into()); }
    fs::read(path).map(Some).map_err(|e| e.to_string())
}

pub fn save_local(root: &Path, relative: &str, bytes: &[u8]) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let destination = root.join(relative);
    let parent = destination.parent().ok_or("Invalid asset destination")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if !parent.starts_with(&root) { return Err("Asset destination is outside the selected library".into()); }
    let filename = destination.file_name().ok_or("Invalid asset filename")?;
    let destination = parent.join(filename);
    if destination.exists() {
        if let Ok(existing) = fs::canonicalize(&destination) {
            if existing.starts_with(&root) && existing.is_file() { return Ok(()); }
        }
        return Err("Asset destination is not a regular local file".into());
    }
    let suffix = TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(".{}.{}.{}.download", filename.to_string_lossy(), std::process::id(), suffix));
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
    if let Err(error) = file.write_all(bytes) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    drop(file);
    if destination.exists() {
        let _ = fs::remove_file(&temporary);
        return Ok(());
    }
    fs::rename(&temporary, &destination).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        e.to_string()
    })
}

fn response(status: u16, content_type: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder().status(status)
        .header("Content-Type", content_type).header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store").body(bytes).expect("valid asset response")
}

pub async fn serve(root: Option<PathBuf>, encoded: String) -> Response<Vec<u8>> {
    let relative = match relative_path(&encoded) { Ok(path) => path, Err(error) => return response(400, "text/plain", error.into_bytes()) };
    let Some(content_type) = mime(&relative) else { return response(400, "text/plain", b"Unsupported asset type".to_vec()) };
    let Some(root) = root else { return response(503, "text/plain", b"Asset library is not configured".to_vec()) };
    let local_relative = relative.clone();
    let local_root = root.clone();
    match tauri::async_runtime::spawn_blocking(move || read_local(&local_root, &local_relative)).await {
        Ok(Ok(Some(bytes))) => return response(200, content_type, bytes),
        Ok(Err(error)) => return response(403, "text/plain", error.into_bytes()),
        Err(error) => return response(500, "text/plain", error.to_string().into_bytes()),
        _ => {},
    }
    // Standing and skill audio are supplied by the selected local library. Missing clips must fail promptly.
    if relative.starts_with("audio/char/") || relative.starts_with("audio/cutscene/") {
        return response(404, "text/plain", format!("Local audio not found: {relative}").into_bytes());
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap_or_default();
    for base in ["https://cdn.jsdelivr.net/gh/LLsetnow/Brown-Dust-2-Asset@master/", "https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/refs/heads/master/"] {
        if let Ok(remote) = client.get(format!("{base}{relative}")).send().await {
            if remote.status().is_success() && remote.content_length().unwrap_or(0) <= 64 * 1024 * 1024 {
                if let Ok(bytes) = remote.bytes().await {
                    if bytes.len() <= 64 * 1024 * 1024 {
                        let downloaded = bytes.to_vec();
                        let root = root.clone();
                        let relative = relative.clone();
                        let save = tauri::async_runtime::spawn_blocking(move || save_local(&root, &relative, &downloaded)).await;
                        match save {
                            Ok(Ok(())) => return response(200, content_type, bytes.to_vec()),
                            Ok(Err(error)) => return response(500, "text/plain", error.into_bytes()),
                            Err(error) => return response(500, "text/plain", error.to_string().into_bytes()),
                        }
                    }
                }
            }
        }
    }
    response(404, "text/plain", format!("Asset not found: {relative}").into_bytes())
}

pub fn local_file(app: &tauri::AppHandle, relative: &str) -> Option<PathBuf> {
    app.state::<AssetLibrary>().file(relative)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_traversal_and_decodes_asset_names() {
        assert_eq!(relative_path("/spine/char/test/texture%20page.png").unwrap(), "spine/char/test/texture page.png");
        for path in ["/spine/../private.png", "/spine/%2e%2e/private.png", "/ui/%5c..%5cprivate.png", "/C:/private.png", "/other/file.png"] { assert!(relative_path(path).is_err(), "{path}"); }
        assert!(mime("spine/test.exe").is_none());
    }
    #[test] fn local_assets_are_read_without_changing_the_repository() {
        let root = std::env::temp_dir().join(format!("bd2-library-test-{}", std::process::id()));
        fs::create_dir_all(root.join("ui")).unwrap();
        fs::write(root.join("ui/texture page.png"), b"local asset").unwrap();
        let canonical = validate_root(root.to_str().unwrap()).unwrap().unwrap();
        assert_eq!(read_local(&canonical, "ui/texture page.png").unwrap().unwrap(), b"local asset");
        assert!(read_local(&canonical, "ui/missing.png").unwrap().is_none());
        assert!(validate_root("relative").is_err());
        assert!(validate_root("").unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
