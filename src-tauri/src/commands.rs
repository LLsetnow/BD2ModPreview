use crate::download::{download_file, get_download_info};
use crate::errors::{DownloadError, Error};
use crate::types::{AudioAsset, DownloadFinished, SpineAssetData};
use crate::utils::{detect_folder_type, file_to_data_uri};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn get_spine_assets(folder_path: String) -> Result<SpineAssetData, Error> {
    let dir_path = Path::new(&folder_path);

    let mut raw_data = HashMap::new();
    let mut skel_path: Option<PathBuf> = None;
    let mut atlas_path: Option<PathBuf> = None;

    if !dir_path.exists() {
        return Err(Error::DirectoryNotFound(folder_path));
    }

    let entries = fs::read_dir(dir_path).map_err(|error| {
        Error::DirectoryInvalidError(folder_path.to_string(), error.to_string())
    })?;

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                match ext {
                    "json" | "skel" => {
                        skel_path = Some(path.clone());
                        let (file_name, data_uri) = file_to_data_uri(&path)?;
                        raw_data.insert(file_name, data_uri);
                    }
                    "atlas" => {
                        atlas_path = Some(path.clone());
                        let (file_name, data_uri) = file_to_data_uri(&path)?;
                        raw_data.insert(file_name, data_uri);
                    }
                    "png" => {
                        let (file_name, data_uri) = file_to_data_uri(&path)?;
                        raw_data.insert(file_name, data_uri);
                    }
                    _ => {}
                }
            }
        }
    }

    let skel_file = skel_path.ok_or(Error::MissingSkeletonOrJson)?;
    let atlas_file = atlas_path.ok_or(Error::MissingAtlas)?;

    let skeleton_filename = skel_file
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(Error::InvalidSkeletonFileName)?
        .to_string();

    let atlas_filename = atlas_file
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(Error::InvalidAtlasFileName)?
        .to_string();

    let (mod_type, id_option) = detect_folder_type(folder_path.clone());

    Ok(SpineAssetData {
        mod_type,
        mod_id: id_option,
        skeleton_filename,
        atlas_filename,
        raw_data,
    })
}

#[tauri::command]
pub fn list_audio_files(folder_path: String) -> Result<Vec<AudioAsset>, String> {
    let root = fs::canonicalize(&folder_path)
        .map_err(|error| format!("Could not open audio folder: {error}"))?;
    if !root.is_dir() {
        return Err("The selected audio path is not a folder.".to_string());
    }

    let mut assets = Vec::new();
    collect_audio_files(&root, &root, &mut assets);
    assets.sort_by_key(|asset| asset.relative_path.to_lowercase());
    Ok(assets)
}

#[tauri::command]
pub fn read_audio_file(folder_path: String, relative_path: String) -> Result<String, String> {
    let root = fs::canonicalize(&folder_path)
        .map_err(|error| format!("Could not open audio folder: {error}"))?;
    let path = fs::canonicalize(root.join(&relative_path))
        .map_err(|error| format!("Could not open audio file: {error}"))?;

    if !path.starts_with(&root) {
        return Err("The audio file must be inside the selected audio folder.".to_string());
    }

    let mime_type = match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("ogg") => "audio/ogg",
        Some(extension) if extension.eq_ignore_ascii_case("mp3") => "audio/mpeg",
        Some(extension) if extension.eq_ignore_ascii_case("wav") => "audio/wav",
        _ => return Err("Only OGG, MP3, and WAV audio files are supported.".to_string()),
    };

    let metadata = fs::metadata(&path).map_err(|error| format!("Could not inspect audio file: {error}"))?;
    const MAX_AUDIO_FILE_SIZE: u64 = 64 * 1024 * 1024;
    if metadata.len() > MAX_AUDIO_FILE_SIZE {
        return Err("Audio files larger than 64 MB are not supported.".to_string());
    }

    let bytes = fs::read(&path).map_err(|error| format!("Could not read audio file: {error}"))?;
    Ok(format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)))
}

fn collect_audio_files(root: &Path, current: &Path, assets: &mut Vec<AudioAsset>) {
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            collect_audio_files(root, &path, assets);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        let supported = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("ogg")
                    || extension.eq_ignore_ascii_case("mp3")
                    || extension.eq_ignore_ascii_case("wav")
            });
        if !supported {
            continue;
        }

        let Ok(relative_path) = path.strip_prefix(root) else {
            continue;
        };
        let Some(file_name) = path.file_name() else {
            continue;
        };

        assets.push(AudioAsset {
            relative_path: relative_path.to_string_lossy().replace('\\', "/"),
            file_name: file_name.to_string_lossy().into_owned(),
        });
    }
}

#[tauri::command]
pub fn download_missing_skeleton(app: AppHandle, folder_path: String) -> Result<(), DownloadError> {
    let (mod_type, char_id_option) = detect_folder_type(folder_path.clone());
    let char_id = char_id_option.ok_or(DownloadError::CharacterIdNotFound)?;

    let (base_url, remote_path, local_filename) = get_download_info(mod_type, &char_id)?;

    let dir_path = Path::new(&folder_path);
    let skel_file_path = dir_path.join(&local_filename);

    if !skel_file_path.exists() {
        download_file(
            app.clone(),
            &format!("{}{}", base_url, remote_path),
            &skel_file_path,
        )?;

        app.emit(
            "download-finished",
            DownloadFinished {
                destination_path: folder_path,
            },
        )
        .map_err(|e| {
            DownloadError::NetworkError(format!("Failed to emit download-finished event: {}", e))
        })?;
    }

    Ok(())
}
