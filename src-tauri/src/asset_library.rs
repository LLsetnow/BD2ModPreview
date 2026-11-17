use percent_encoding::percent_decode_str;
use std::{fs, path::{Component, Path, PathBuf}, sync::Mutex, time::Duration};
use tauri::{http::Response, Manager};

#[derive(Default)]
pub struct AssetLibrary {
    root: Mutex<Option<PathBuf>>,
}

impl AssetLibrary {
    pub fn root(&self) -> Option<PathBuf> { self.root.lock().ok().and_then(|root| root.clone()) }
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
    let root = fs::canonicalize(path).map_err(|e| format!("Could not open asset library: {e}"))?;
    if !root.is_dir() || !["spine", "ui", "audio", "backgrounds"].iter().any(|name| root.join(name).is_dir()) {
        return Err("Choose the asset repository root containing spine, ui, audio or backgrounds".into());
    }
    Ok(Some(root))
}

#[tauri::command]
pub fn set_asset_library_root(state: tauri::State<AssetLibrary>, directory: String) -> Result<(), String> {
    let result = validate_root(&directory);
    let mut current = state.root.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(root) => { *current = root; Ok(()) },
        Err(error) => { *current = None; Err(error) },
    }
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

fn response(status: u16, content_type: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder().status(status)
        .header("Content-Type", content_type).header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store").body(bytes).expect("valid asset response")
}

pub async fn serve(root: Option<PathBuf>, encoded: String) -> Response<Vec<u8>> {
    let relative = match relative_path(&encoded) { Ok(path) => path, Err(error) => return response(400, "text/plain", error.into_bytes()) };
    let Some(content_type) = mime(&relative) else { return response(400, "text/plain", b"Unsupported asset type".to_vec()) };
    let Some(root) = root else { return response(404, "text/plain", b"Asset library is not configured".to_vec()) };
    let local_relative = relative.clone();
    match tauri::async_runtime::spawn_blocking(move || read_local(&root, &local_relative)).await {
        Ok(Ok(Some(bytes))) => return response(200, content_type, bytes),
        Ok(Err(error)) => return response(403, "text/plain", error.into_bytes()),
        Err(error) => return response(500, "text/plain", error.to_string().into_bytes()),
        _ => {},
    }
    // Standing and skill audio are supplied by the selected local library. Missing clips must fail promptly.
    if relative.starts_with("audio/standing/") || relative.starts_with("audio/skills/") {
        return response(404, "text/plain", format!("Local audio not found: {relative}").into_bytes());
    }
    // Keep the existing online fallback for incomplete local repositories.
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap_or_default();
    for base in ["https://cdn.jsdelivr.net/gh/bruhnn/Brown-Dust-2-Asset@master/", "https://raw.githubusercontent.com/bruhnn/Brown-Dust-2-Asset/refs/heads/master/"] {
        if let Ok(remote) = client.get(format!("{base}{relative}")).send().await {
            if remote.status().is_success() && remote.content_length().unwrap_or(0) <= 64 * 1024 * 1024 {
                if let Ok(bytes) = remote.bytes().await {
                    if bytes.len() <= 64 * 1024 * 1024 { return response(200, content_type, bytes.to_vec()); }
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
        assert!(validate_root(root.join("ui").to_str().unwrap()).is_err());
        assert!(validate_root("").unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
