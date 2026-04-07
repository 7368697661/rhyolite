use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;
use tokio::fs;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsProject {
    pub id: String,
    pub name: String,
    pub story_outline: String,
    pub lore_bible: String,
}

#[tauri::command]
pub async fn list_projects(app_handle: tauri::AppHandle) -> Result<Vec<FsProject>, String> {
    // For now, load projects from known-projects.json if it exists, otherwise return a default
    let w_dir = get_workspace_dir(&app_handle).await?;
    let kp_path = w_dir.join("known-projects.json");

    let mut projects = Vec::new();

    if let Ok(content) = fs::read_to_string(&kp_path).await {
        if let Ok(registry) = serde_json::from_str::<HashMap<String, String>>(&content) {
            for (id, path_str) in registry {
                let name = PathBuf::from(&path_str)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();

                // Try to read project.json
                let proj_json_path = PathBuf::from(&path_str).join(".rhyolite").join("project.json");
                if let Ok(content) = fs::read_to_string(&proj_json_path).await {
                    if let Ok(p) = serde_json::from_str::<FsProject>(&content) {
                        projects.push(p);
                        continue;
                    }
                }

                projects.push(FsProject {
                    id: id.clone(),
                    name,
                    story_outline: "".to_string(),
                    lore_bible: "".to_string(),
                });
            }
        }
    }

    // If no projects in registry, let's look for directories in the workspace
    if projects.is_empty() {
        if let Ok(mut entries) = fs::read_dir(&w_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if let Ok(metadata) = entry.metadata().await {
                    if metadata.is_dir() {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if !name.starts_with('.') {
                            let proj_json_path = entry.path().join(".rhyolite").join("project.json");
                            if let Ok(content) = fs::read_to_string(&proj_json_path).await {
                                if let Ok(p) = serde_json::from_str::<FsProject>(&content) {
                                    projects.push(p);
                                    continue;
                                }
                            }

                            projects.push(FsProject {
                                id: name.clone(),
                                name,
                                story_outline: "".to_string(),
                                lore_bible: "".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    if projects.is_empty() {
        // Fallback demo project
        projects.push(FsProject {
            id: "demo_project".to_string(),
            name: "Demo Project".to_string(),
            story_outline: "".to_string(),
            lore_bible: "".to_string(),
        });
    }

    Ok(projects)
}

#[tauri::command]
pub async fn list_folders(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<FsFolder>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let mut folders = Vec::new();

    let base_dirs = vec![
        (p_dir.join("crystals"), "document"),
        (p_dir.join("artifacts"), "wiki"),
        (p_dir.join("timelines"), "timeline"),
    ];

    for (base_dir, f_type) in base_dirs {
        let mut queue = std::collections::VecDeque::new();
        queue.push_back(base_dir.clone());

        while let Some(current_dir) = queue.pop_front() {
            if let Ok(mut dir_entries) = fs::read_dir(&current_dir).await {
                while let Ok(Some(entry)) = dir_entries.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        if let Ok(rel) = path.strip_prefix(&base_dir) {
                            let folder_id = rel.to_string_lossy().into_owned().replace("\\", "/");
                            let name = path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into_owned();

                            folders.push(FsFolder {
                                id: folder_id,
                                project_id: project_id.clone(),
                                name,
                                r#type: f_type.to_string(),
                            });
                        }
                        queue.push_back(path);
                    }
                }
            }
        }
    }

    Ok(folders)
}

#[tauri::command]
pub async fn list_timelines(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<FsTimeline>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let timelines_dir = p_dir.join("timelines");
    let mut timelines = Vec::new();

    if let Ok(mut entries) = fs::read_dir(timelines_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path).await {
                    if let Ok(timeline) = serde_json::from_str::<FsTimeline>(&content) {
                        timelines.push(timeline);
                    }
                }
            }
        }
    }

    Ok(timelines)
}

#[tauri::command]
pub async fn read_timeline(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
) -> Result<Option<FsTimeline>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let path = p_dir.join("timelines").join(format!("{}.json", id));

    if let Ok(content) = fs::read_to_string(&path).await {
        if let Ok(timeline) = serde_json::from_str::<FsTimeline>(&content) {
            return Ok(Some(timeline));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn write_timeline(
    app_handle: tauri::AppHandle,
    project_id: String,
    timeline: FsTimeline,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let path = p_dir
        .join("timelines")
        .join(format!("{}.json", timeline.id));

    let json = serde_json::to_string_pretty(&timeline).map_err(|e| e.to_string())?;
    fs::write(path, json).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_timeline(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let path = p_dir.join("timelines").join(format!("{}.json", id));

    fs::remove_file(path).await.map_err(|e| e.to_string())
}

use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn get_config(
    app_handle: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    // 1. Check environment variables
    if let Ok(val) = std::env::var(&key) {
        if !val.is_empty() {
            return Ok(Some(val));
        }
    }
    if let Ok(val) = std::env::var(format!("VITE_{}", &key)) {
        if !val.is_empty() {
            return Ok(Some(val));
        }
    }

    // 2. Check dotenvy
    if let Ok(val) = dotenvy::var(&key) {
        if !val.is_empty() {
            return Ok(Some(val));
        }
    }
    if let Ok(val) = dotenvy::var(format!("VITE_{}", &key)) {
        if !val.is_empty() {
            return Ok(Some(val));
        }
    }

    // 3. Fallback to manual parsing just in case
    let w_dir = get_workspace_dir(&app_handle).await?;
    let env_file = w_dir.join(".env");
    if let Ok(content) = tokio::fs::read_to_string(&env_file).await {
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with('#') || line.is_empty() {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == key || k.trim() == format!("VITE_{}", key) {
                    let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    if !val.is_empty() {
                        return Ok(Some(val));
                    }
                }
            }
        }
    }

    // 4. Also check .env in the app bundle directory for Tauri (when in dev mode)
    if let Ok(current_dir) = std::env::current_dir() {
        let env_paths = vec![
            current_dir.join(".env"),
            current_dir.join("..").join(".env"),
        ];
        for path in env_paths {
            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                for line in content.lines() {
                    let line = line.trim();
                    if line.starts_with('#') || line.is_empty() {
                        continue;
                    }
                    if let Some((k, v)) = line.split_once('=') {
                        if k.trim() == key || k.trim() == format!("VITE_{}", key) {
                            let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                            if !val.is_empty() {
                                return Ok(Some(val));
                            }
                        }
                    }
                }
            }
        }
    }

    // 5. Check config.json
    let config_file = w_dir.join("config.json");

    if let Ok(content) = fs::read_to_string(&config_file).await {
        if let Ok(config) = serde_json::from_str::<HashMap<String, String>>(&content) {
            return Ok(config.get(&key).cloned());
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn set_config(
    app_handle: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let w_dir = get_workspace_dir(&app_handle).await?;
    let config_file = w_dir.join("config.json");

    let mut config: HashMap<String, String> = HashMap::new();
    if let Ok(content) = fs::read_to_string(&config_file).await {
        if let Ok(c) = serde_json::from_str(&content) {
            config = c;
        }
    }

    config.insert(key, value);
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_file, json)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let folder_path = app_handle.dialog().file().blocking_pick_folder();
    if let Some(folder_path) = folder_path {
        let folder_str = folder_path.to_string();

        let path = PathBuf::from(folder_str.clone());
        let folder_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();

        let w_dir = get_workspace_dir(&app_handle).await?;
        let kp_path = w_dir.join("known-projects.json");

        let mut registry: HashMap<String, String> = HashMap::new();
        if let Ok(content) = fs::read_to_string(&kp_path).await {
            if let Ok(reg) = serde_json::from_str(&content) {
                registry = reg;
            }
        }

        // Use folder name as project ID for simplicity (in a real app, generate a UUID or sanitize)
        let project_id = folder_name.replace(" ", "_").to_lowercase();
        registry.insert(project_id.clone(), folder_str);

        if let Ok(json) = serde_json::to_string_pretty(&registry) {
            let _ = fs::write(&kp_path, json).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn create_folder(
    app_handle: tauri::AppHandle,
    project_id: String,
    parent_folder_id: Option<String>,
    name: String,
    r#type: String,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let base_dir = match r#type.as_str() {
        "document" => p_dir.join("crystals"),
        "wiki" => p_dir.join("artifacts"),
        "timeline" => p_dir.join("timelines"),
        _ => return Err("Invalid type".to_string()),
    };

    let target_dir = if let Some(parent) = parent_folder_id {
        base_dir.join(parent).join(name)
    } else {
        base_dir.join(name)
    };

    fs::create_dir_all(target_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_file(
    app_handle: tauri::AppHandle,
    project_id: String,
    folder_id: Option<String>,
    name: String,
    r#type: String,
) -> Result<String, String> {
    if name.contains("..") || folder_id.as_deref().map_or(false, |f| f.contains("..")) {
        return Err("Invalid path: traversal not allowed".into());
    }
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let base_dir = match r#type.as_str() {
        "document" => p_dir.join("crystals"),
        "wiki" => p_dir.join("artifacts"),
        "timeline" => p_dir.join("timelines"),
        _ => return Err("Invalid type".to_string()),
    };

    let target_dir = if let Some(parent) = &folder_id {
        base_dir.join(parent)
    } else {
        base_dir.clone()
    };

    fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| e.to_string())?;

    // add .md
    let file_name = format!("{}.md", name);
    let target_file = target_dir.join(&file_name);

    fs::write(&target_file, "")
        .await
        .map_err(|e| e.to_string())?;

    // Return the new ID
    if let Some(f) = folder_id {
        Ok(format!("{}/{}", f, name))
    } else {
        Ok(name)
    }
}

#[tauri::command]
pub async fn delete_file(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
    r#type: String,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let base_dir = match r#type.as_str() {
        "document" => p_dir.join("crystals"),
        "wiki" => p_dir.join("artifacts"),
        "timeline" => p_dir.join("timelines"),
        _ => return Err("Invalid type".to_string()),
    };

    let target_file = base_dir.join(format!("{}.md", id));
    fs::remove_file(target_file)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_folder(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
    r#type: String,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let base_dir = match r#type.as_str() {
        "document" => p_dir.join("crystals"),
        "wiki" => p_dir.join("artifacts"),
        "timeline" => p_dir.join("timelines"),
        _ => return Err("Invalid type".to_string()),
    };

    let target_dir = base_dir.join(id);
    fs::remove_dir_all(target_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_file(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
    r#type: String,
    new_folder_id: Option<String>,
) -> Result<(), String> {
    if id.contains("..") || new_folder_id.as_deref().map_or(false, |f| f.contains("..")) {
        return Err("Invalid path: traversal not allowed".into());
    }
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let base_dir = match r#type.as_str() {
        "document" => p_dir.join("crystals"),
        "wiki" => p_dir.join("artifacts"),
        "timeline" => p_dir.join("timelines"),
        _ => return Err("Invalid type".to_string()),
    };

    let target_file = base_dir.join(format!("{}.md", id));

    let new_dir = if let Some(folder) = new_folder_id {
        base_dir.join(folder)
    } else {
        base_dir.clone()
    };

    let filename = target_file.file_name().ok_or("Invalid filename")?;
    let new_target_file = new_dir.join(filename);

    if target_file != new_target_file {
        fs::create_dir_all(&new_dir)
            .await
            .map_err(|e| e.to_string())?;
        fs::rename(target_file, new_target_file)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn chat(_text: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn update_document(
    app_handle: tauri::AppHandle,
    project_id: Option<String>,
    id: String,
    _title: String,
    content: String,
) -> Result<(), String> {
    if id.contains("..") { return Err("Invalid id: path traversal".into()); }

    if let Some(pid) = project_id {
        let p_dir = get_project_dir(&app_handle, &pid).await?;
        let crystals_dir = p_dir.join("crystals");
        let file_path = crystals_dir.join(format!("{}.md", &id));
        if file_path.exists() {
            fs::write(&file_path, &content).await.map_err(|e| e.to_string())?;
            return Ok(());
        }
        return Err(format!("Document not found in project {}: {}", pid, id));
    }

    let ws = get_workspace_dir(&app_handle).await?;
    let config_str = fs::read_to_string(ws.join("known-projects.json")).await.unwrap_or_default();
    let registry: std::collections::HashMap<String, String> =
        serde_json::from_str(&config_str).unwrap_or_default();

    for (_pid, folder_str) in &registry {
        let p_dir = std::path::PathBuf::from(folder_str);
        let crystals_dir = p_dir.join("crystals");
        let file_path = crystals_dir.join(format!("{}.md", &id));
        if file_path.exists() {
            fs::write(&file_path, &content).await.map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err(format!("Document not found: {}", id))
}

#[tauri::command]
pub async fn update_wiki_entry(
    app_handle: tauri::AppHandle,
    project_id: Option<String>,
    id: String,
    title: String,
    content: String,
) -> Result<(), String> {
    if id.contains("..") { return Err("Invalid id: path traversal".into()); }

    if let Some(pid) = project_id {
        let p_dir = get_project_dir(&app_handle, &pid).await?;
        let artifacts_dir = p_dir.join("artifacts");
        let file_path = artifacts_dir.join(format!("{}.md", &id));
        if file_path.exists() {
            fs::write(&file_path, &content).await.map_err(|e| e.to_string())?;
            return Ok(());
        }
        let new_path = artifacts_dir.join(format!("{}.md", if id.is_empty() { &title } else { &id }));
        fs::create_dir_all(&artifacts_dir).await.map_err(|e| e.to_string())?;
        fs::write(&new_path, &content).await.map_err(|e| e.to_string())?;
        return Ok(());
    }

    let ws = get_workspace_dir(&app_handle).await?;
    let config_str = fs::read_to_string(ws.join("known-projects.json")).await.unwrap_or_default();
    let registry: std::collections::HashMap<String, String> =
        serde_json::from_str(&config_str).unwrap_or_default();

    for (_pid, folder_str) in &registry {
        let p_dir = std::path::PathBuf::from(folder_str);
        let artifacts_dir = p_dir.join("artifacts");
        let file_path = artifacts_dir.join(format!("{}.md", &id));
        if file_path.exists() {
            fs::write(&file_path, &content).await.map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    for (_pid, folder_str) in &registry {
        let p_dir = std::path::PathBuf::from(folder_str);
        let artifacts_dir = p_dir.join("artifacts");
        if artifacts_dir.exists() {
            let file_path = artifacts_dir.join(format!("{}.md", if id.is_empty() { &title } else { &id }));
            fs::write(&file_path, &content).await.map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err(format!("Wiki entry not found: {}", id))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsGlyph {
    pub id: String,
    pub name: String,
    pub model: String,
    pub temperature: f64,
    pub output_length: u32,
    pub is_sculpter: bool,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_role: Option<String>,
}

#[tauri::command]
pub async fn list_glyphs(app_handle: tauri::AppHandle) -> Result<Vec<FsGlyph>, String> {
    let w_dir = get_workspace_dir(&app_handle).await?;
    let glyphs_file = w_dir.join("glyphs.json");

    if let Ok(content) = fs::read_to_string(&glyphs_file).await {
        if let Ok(glyphs) = serde_json::from_str::<Vec<FsGlyph>>(&content) {
            return Ok(glyphs);
        }
    }
    Ok(vec![])
}

#[tauri::command]
pub async fn save_glyph(app_handle: tauri::AppHandle, glyph: FsGlyph) -> Result<(), String> {
    let w_dir = get_workspace_dir(&app_handle).await?;
    let glyphs_file = w_dir.join("glyphs.json");

    let mut glyphs = list_glyphs(app_handle.clone()).await.unwrap_or_default();
    if let Some(pos) = glyphs.iter().position(|g| g.id == glyph.id) {
        glyphs[pos] = glyph;
    } else {
        glyphs.push(glyph);
    }

    let json = serde_json::to_string_pretty(&glyphs).map_err(|e| e.to_string())?;
    fs::write(glyphs_file, json)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_glyph(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let w_dir = get_workspace_dir(&app_handle).await?;
    let glyphs_file = w_dir.join("glyphs.json");

    let mut glyphs = list_glyphs(app_handle.clone()).await.unwrap_or_default();
    glyphs.retain(|g| g.id != id);

    let json = serde_json::to_string_pretty(&glyphs).map_err(|e| e.to_string())?;
    fs::write(glyphs_file, json)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsChatMessage {
    pub id: String,
    pub role: String, // "user" | "model" | "assistant"
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<serde_json::Value>>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_message_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsChat {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeline_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tip_message_id: Option<String>,
    pub messages: Vec<FsChatMessage>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn list_chats(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<FsChat>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let chats_dir = p_dir.join("chats");
    let mut chats = Vec::new();

    if let Ok(mut entries) = fs::read_dir(chats_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path).await {
                    if let Ok(chat) = serde_json::from_str::<FsChat>(&content) {
                        chats.push(chat);
                    }
                }
            }
        }
    }

    chats.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(chats)
}

#[tauri::command]
pub async fn read_chat(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
) -> Result<Option<FsChat>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let path = p_dir.join("chats").join(format!("{}.json", id));

    if let Ok(content) = fs::read_to_string(&path).await {
        if let Ok(chat) = serde_json::from_str::<FsChat>(&content) {
            return Ok(Some(chat));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn write_chat(
    app_handle: tauri::AppHandle,
    project_id: String,
    chat: FsChat,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let path = p_dir.join("chats").join(format!("{}.json", chat.id));

    let json = serde_json::to_string_pretty(&chat).map_err(|e| e.to_string())?;
    fs::write(path, json).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_chat(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let path = p_dir.join("chats").join(format!("{}.json", id));

    fs::remove_file(path).await.map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsFolder {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub r#type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsWikiEntry {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub aliases: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsDocument {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsTimeline {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub events: Vec<FsTimelineEvent>,
    #[serde(default)]
    pub edges: Vec<FsEventEdge>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsTimelineEvent {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_type: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pass_full_content: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_type: Option<String>,
    #[serde(default)]
    pub position_x: f64,
    #[serde(default)]
    pub position_y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsEventEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub label: String,
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FsTemplate {
    pub name: String,
    pub filename: String,
    pub content: String,
    pub frontmatter: serde_json::Value,
}

#[tauri::command]
pub async fn list_templates(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<FsTemplate>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let templates_dir = p_dir.join("_templates");
    let mut results = Vec::new();

    if let Ok(mut entries) = fs::read_dir(&templates_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file()
                && path.extension().and_then(|s| s.to_str()) == Some("md")
                && !path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .starts_with('.')
            {
                if let Ok(text) = fs::read_to_string(&path).await {
                    let filename = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned();
                    let name = filename
                        .trim_end_matches(".md")
                        .replace('_', " ");

                    // Simple frontmatter parsing: strip leading ---...--- block
                    let (frontmatter, content) = if text.starts_with("---") {
                        if let Some(end_idx) = text[3..].find("---") {
                            let fm_str = &text[3..3 + end_idx].trim();
                            let fm: serde_json::Value =
                                serde_yaml_ng::from_str(fm_str).unwrap_or(serde_json::Value::Null);
                            let body = text[3 + end_idx + 3..].trim_start().to_string();
                            (fm, body)
                        } else {
                            (serde_json::Value::Null, text)
                        }
                    } else {
                        (serde_json::Value::Null, text)
                    };

                    results.push(FsTemplate {
                        name,
                        filename,
                        content,
                        frontmatter,
                    });
                }
            }
        }
    }

    Ok(results)
}

// Workspaces and Projects
pub async fn get_workspace_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Better defaults: use standard AppData dir, or fallback to current dir
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let path = if let Ok(w_dir) = std::env::var("WORKSPACE_DIR") {
        PathBuf::from(w_dir)
    } else {
        app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| cwd.join(".workspace"))
    };

    fs::create_dir_all(&path).await.map_err(|e| e.to_string())?;
    Ok(path)
}

pub async fn get_project_dir(
    app_handle: &tauri::AppHandle,
    project_id: &str,
) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("PROJECT_DIR") {
        if !dir.is_empty() {
            let path = PathBuf::from(dir);
            ensure_project_subdirs(&path).await?;
            return Ok(path);
        }
    }

    // Check known-projects.json
    let w_dir = get_workspace_dir(app_handle).await?;
    let kp_path = w_dir.join("known-projects.json");
    if let Ok(content) = fs::read_to_string(&kp_path).await {
        if let Ok(registry) = serde_json::from_str::<HashMap<String, String>>(&content) {
            if let Some(ext_path) = registry.get(project_id) {
                let path = PathBuf::from(ext_path);
                if path.is_dir() {
                    ensure_project_subdirs(&path).await?;
                    return Ok(path);
                }
            }
        }
    }

    let dir = w_dir.join(project_id);
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    ensure_project_subdirs(&dir).await?;
    Ok(dir)
}

async fn ensure_project_subdirs(dir: &PathBuf) -> Result<(), String> {
    let subdirs = ["crystals", "artifacts", "timelines", "chats", ".rhyolite"];
    for sub in subdirs {
        fs::create_dir_all(dir.join(sub))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_wiki_entries(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<FsWikiEntry>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let artifacts_dir = p_dir.join("artifacts");
    let mut entries = Vec::new();

    let mut queue = std::collections::VecDeque::new();
    queue.push_back(artifacts_dir.clone());

    while let Some(current_dir) = queue.pop_front() {
        if let Ok(mut entries_dir) = fs::read_dir(&current_dir).await {
            while let Ok(Some(entry)) = entries_dir.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    queue.push_back(path);
                } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md")
                {
                    let folder_id = if let Ok(rel_path) = current_dir.strip_prefix(&artifacts_dir) {
                        let rel_str = rel_path.to_string_lossy().into_owned().replace("\\", "/");
                        if rel_str.is_empty() {
                            None
                        } else {
                            Some(rel_str)
                        }
                    } else {
                        None
                    };

                    if let Ok(content) = fs::read_to_string(&path).await {
                        let file_stem = path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned();
                        let id = if let Ok(rel) = path.strip_prefix(&artifacts_dir) {
                            rel.with_extension("")
                                .to_string_lossy()
                                .into_owned()
                                .replace("\\", "/")
                        } else {
                            file_stem.clone()
                        };

                        entries.push(FsWikiEntry {
                            id,
                            project_id: project_id.clone(),
                            title: file_stem,
                            content,
                            aliases: "".to_string(),
                            folder_id,
                            category: None,
                            created_at: "".to_string(),
                            updated_at: "".to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn list_documents(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<FsDocument>, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let crystals_dir = p_dir.join("crystals");
    let mut docs = Vec::new();

    let mut queue = std::collections::VecDeque::new();
    queue.push_back(crystals_dir.clone());

    while let Some(current_dir) = queue.pop_front() {
        if let Ok(mut entries_dir) = fs::read_dir(&current_dir).await {
            while let Ok(Some(entry)) = entries_dir.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    queue.push_back(path);
                } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md")
                {
                    let folder_id = if let Ok(rel_path) = current_dir.strip_prefix(&crystals_dir) {
                        let rel_str = rel_path.to_string_lossy().into_owned().replace("\\", "/");
                        if rel_str.is_empty() {
                            None
                        } else {
                            Some(rel_str)
                        }
                    } else {
                        None
                    };

                    if let Ok(content) = fs::read_to_string(&path).await {
                        let file_stem = path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned();
                        let id = if let Ok(rel) = path.strip_prefix(&crystals_dir) {
                            rel.with_extension("")
                                .to_string_lossy()
                                .into_owned()
                                .replace("\\", "/")
                        } else {
                            file_stem.clone()
                        };

                        docs.push(FsDocument {
                            id,
                            project_id: project_id.clone(),
                            title: file_stem,
                            content,
                            folder_id,
                            created_at: "".to_string(),
                            updated_at: "".to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(docs)
}
#[tauri::command]
pub async fn read_project(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<FsProject, String> {
    let p_dir = get_project_dir(&app_handle, &project_id).await?;
    let path = p_dir.join("project.json");

    if let Ok(content) = fs::read_to_string(&path).await {
        if let Ok(p) = serde_json::from_str::<FsProject>(&content) {
            return Ok(p);
        }
    }

    // Default if not found
    Ok(FsProject {
        id: project_id.clone(),
        name: "Unknown Project".to_string(), // You might want to resolve actual name here
        story_outline: "".to_string(),
        lore_bible: "".to_string(),
    })
}

#[tauri::command]
pub async fn update_project(
    app_handle: tauri::AppHandle,
    project: FsProject,
) -> Result<(), String> {
    let p_dir = get_project_dir(&app_handle, &project.id).await?;
    let path = p_dir.join("project.json");

    let json = serde_json::to_string_pretty(&project).map_err(|e| e.to_string())?;
    fs::write(path, json).await.map_err(|e| e.to_string())
}
