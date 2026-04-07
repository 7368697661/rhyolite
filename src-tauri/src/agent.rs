use serde_json::Value;

pub trait AgentTool {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn execute(&self, args: Value, context: ToolContext) -> Result<Value, String>;
}

pub struct ToolContext {
    pub project_id: String,
    pub timeline_id: Option<String>,
    pub document_id: Option<String>,
}

#[tauri::command]
pub async fn run_agent_loop(_project_id: String, _query: String) -> Result<String, String> {
    Ok("hello from rust agent".to_string())
}
