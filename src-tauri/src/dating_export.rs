use serde_json::{json, Value};
use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

const MAX_VALIDITY_MS: u64 = 7 * 24 * 60 * 60 * 1000;
fn valid_scene_id(id: &str) -> bool {
    id.strip_prefix("illust_dating").is_some_and(|number| {
        !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit())
            && number.parse::<u32>().is_ok_and(|n| n > 0 && n <= 9999)
    })
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[tauri::command]
pub async fn export_dating_scene(
    path: PathBuf,
    scene_id: String,
    expires_at_ms: u64,
    scene: Value,
) -> Result<String, String> {
    if !valid_scene_id(&scene_id) {
        return Err("Unsupported dating scene".into());
    }
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_millis() as u64;
    if expires_at_ms <= now_ms || expires_at_ms > now_ms + MAX_VALIDITY_MS {
        return Err("Dating authorization has expired".into());
    }
    if !scene.get("groups").is_some_and(Value::is_array)
        || !scene.get("points").is_some_and(Value::is_array)
        || !scene.get("skeleton").is_some_and(Value::is_string)
    {
        return Err("Invalid dating scene data".into());
    }

    let events = scene.pointer("/audio/events").and_then(Value::as_object)
        .ok_or_else(|| "Missing dating audio mapping".to_string())?;
    for event in events.values() {
        let hash = event.get("file").and_then(Value::as_str)
            .ok_or_else(|| "Invalid dating audio event".to_string())?;
        if !valid_hash(hash) { return Err("Invalid dating audio hash".into()); }
    }

    if !path.is_absolute() || path.extension().and_then(|s| s.to_str()) != Some("json") {
        return Err("Choose an absolute JSON file path".into());
    }
    let parent = path.parent().ok_or("Invalid export path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let manifest = json!({
        "schemaVersion": 1,
        "sceneId": scene_id,
        "expiresAtMs": expires_at_ms,
        "scene": scene,
    });
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temporary, serde_json::to_vec(&manifest).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_canonical_dating_ids() {
        for id in ["illust_dating1", "illust_dating22", "illust_dating9999"] { assert!(valid_scene_id(id)); }
        for id in ["illust_dating0", "illust_dating-1", "illust_dating", "illust_dating1/../2", "illust_dating10000"] { assert!(!valid_scene_id(id)); }
    }
}
