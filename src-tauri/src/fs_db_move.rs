#[tauri::command]
pub async fn move_file(
    app_handle: tauri::AppHandle,
    project_id: String,
    id: String,
    r#type: String,
    new_folder_id: Option<String>,
) -> Result<(), String> {
    let p_dir = crate::fs_db::get_project_dir(&app_handle, &project_id).await?;
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
        tokio::fs::create_dir_all(&new_dir).await.map_err(|e| e.to_string())?;
        tokio::fs::rename(target_file, new_target_file).await.map_err(|e| e.to_string())?;
    }
    
    Ok(())
}
