use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}, time::Duration};
use tauri::Manager;

const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/LLsetnow/Brown-Dust-2-Asset@master/backgrounds/cutscene/",
    "https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/master/backgrounds/cutscene/",
];

fn asset_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.state::<crate::asset_library::AssetLibrary>().root()
        .ok_or_else(|| "Choose an asset library directory in BD2ModManager settings".to_string())
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
pub async fn get_game_background(app: tauri::AppHandle, hash: String) -> Result<String, String> {
    if !valid_hash(&hash) { return Err("Invalid background hash".into()); }
    let root = asset_root(&app)?;
    let relative = format!("backgrounds/cutscene/{hash}.webp");
    let local_path = crate::asset_library::local_file(&app, &relative);
    if let Some(data) = local_path.as_deref().and_then(|path| read_verified(path, &hash)) {
        return Ok(format!("data:image/webp;base64,{}", STANDARD.encode(data)));
    }
    if let Some(path) = local_path { fs::remove_file(path).map_err(|e| e.to_string())?; }
    let data = download(&hash).await?;
    crate::asset_library::save_local(&root, &relative, &data)?;
    Ok(format!("data:image/webp;base64,{}", STANDARD.encode(data)))
}

#[tauri::command]
pub fn has_game_backgrounds(
    app: tauri::AppHandle,
    hashes: Vec<String>,
) -> Result<bool, String> {
    Ok(hashes.iter().all(|hash| valid_hash(hash) &&
        crate::asset_library::local_file(&app, &format!("backgrounds/cutscene/{hash}.webp"))
            .as_deref().and_then(|path| read_verified(path, hash)).is_some()))
}
