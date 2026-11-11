use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}, time::Duration};
use tauri::Manager;

const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/bruhnn/Brown-Dust-2-Asset@master/backgrounds/cutscene/",
    "https://raw.githubusercontent.com/bruhnn/Brown-Dust-2-Asset/master/backgrounds/cutscene/",
];

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("game-backgrounds"))
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn read_verified(path: &Path, hash: &str) -> Option<Vec<u8>> {
    let data = fs::read(path).ok()?;
    (hex::encode(Sha256::digest(&data)) == hash).then_some(data)
}

async fn download(hash: &str) -> Result<Vec<u8>, String> {
    let mut sources: Vec<String> = SOURCES.iter().map(|s| s.to_string()).collect();
    // For testing before the images are uploaded, e.g. BD2_BACKGROUNDS_URL=http://127.0.0.1:8765/
    if let Ok(url) = std::env::var("BD2_BACKGROUNDS_URL") {
        sources.insert(0, url);
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let mut errors = Vec::new();
    for base in sources {
        let response = client.get(format!("{base}{hash}.webp")).send().await.and_then(|r| r.error_for_status());
        match response {
            Ok(response) => match response.bytes().await {
                Ok(data) if hex::encode(Sha256::digest(&data)) == hash => return Ok(data.to_vec()),
                Ok(_) => errors.push(format!("{base}: checksum mismatch")),
                Err(error) => errors.push(error.to_string()),
            },
            Err(error) => errors.push(error.to_string()),
        }
    }
    Err(errors.join("; "))
}

#[tauri::command]
pub async fn get_game_background(app: tauri::AppHandle, hash: String, background_directory: String) -> Result<String, String> {
    if !valid_hash(&hash) { return Err("Invalid background hash".into()); }
    let dir = cache_dir(&app)?;
    let path = dir.join(format!("{hash}.webp"));
    let local_path = if background_directory.trim().is_empty() { None } else {
        Some(Path::new(&background_directory).join(format!("{hash}.webp")))
    };
    let data = local_path.as_deref().and_then(|path| read_verified(path, &hash))
        .or_else(|| read_verified(&path, &hash));
    let data = match data {
        Some(data) => data,
        None => {
            let data = download(&hash).await?;
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            fs::write(&path, &data).map_err(|e| e.to_string())?;
            data
        }
    };
    Ok(format!("data:image/webp;base64,{}", STANDARD.encode(data)))
}

#[tauri::command]
pub fn has_game_backgrounds(
    app: tauri::AppHandle,
    hashes: Vec<String>,
    background_directory: String,
) -> Result<bool, String> {
    let dir = cache_dir(&app)?;
    let local_dir = Path::new(&background_directory);
    Ok(hashes.iter().all(|hash| valid_hash(hash) && (
        dir.join(format!("{hash}.webp")).is_file()
            || (!background_directory.trim().is_empty() && local_dir.join(format!("{hash}.webp")).is_file())
    )))
}

#[tauri::command]
pub fn get_game_background_cache_size(app: tauri::AppHandle) -> Result<u64, String> {
    let Ok(entries) = fs::read_dir(cache_dir(&app)?) else { return Ok(0) };
    Ok(entries.flatten().filter_map(|entry| entry.metadata().ok()).map(|m| m.len()).sum())
}

#[tauri::command]
pub fn clear_game_background_cache(app: tauri::AppHandle) -> Result<(), String> {
    let _ = fs::remove_dir_all(cache_dir(&app)?);
    Ok(())
}
