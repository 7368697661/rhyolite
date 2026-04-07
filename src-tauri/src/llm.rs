use reqwest::Client;

#[tauri::command]
pub async fn test_gemini() -> Result<String, String> {
    let _client = Client::new();
    // stub
    Ok("hello from rust".to_string())
}
