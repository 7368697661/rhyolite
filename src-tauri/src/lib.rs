pub mod agent;
pub mod fs_db;
pub mod llm;
pub mod rag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            fs_db::list_projects,
            fs_db::read_project,
            fs_db::update_project,
            fs_db::list_folders,
            fs_db::list_timelines,
            fs_db::read_timeline,
            fs_db::write_timeline,
            fs_db::delete_timeline,
            fs_db::list_wiki_entries,
            fs_db::list_documents,
            fs_db::open_folder,
            fs_db::chat,
            fs_db::update_document,
            fs_db::update_wiki_entry,
            fs_db::create_folder,
            fs_db::create_file,
            fs_db::delete_file,
            fs_db::delete_folder,
            fs_db::move_file,
            fs_db::list_glyphs,
            fs_db::save_glyph,
            fs_db::delete_glyph,
            fs_db::list_chats,
            fs_db::read_chat,
            fs_db::write_chat,
            fs_db::delete_chat,
            fs_db::get_config,
            fs_db::set_config,
            fs_db::list_templates,
            rag::retrieve_similar,
            rag::update_project_embeddings,
            rag::embed_single_entry,
            llm::test_gemini,
            agent::run_agent_loop
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
