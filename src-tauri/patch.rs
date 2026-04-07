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
