use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;

use crate::fs_db::{get_project_dir, get_workspace_dir, list_documents, list_wiki_entries, list_timelines};

const EMBEDDING_MODEL: &str = "text-embedding-004";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EmbeddingEntry {
    pub id: String,
    pub r#type: String, // "wiki" | "document"
    pub title: String,
    pub vector: Vec<f32>,
    #[serde(rename = "contentHash")]
    pub content_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EmbeddingIndex {
    pub version: u32,
    pub entries: HashMap<String, EmbeddingEntry>,
}

impl Default for EmbeddingIndex {
    fn default() -> Self {
        Self {
            version: 1,
            entries: HashMap::new(),
        }
    }
}

pub fn cosine_similarity(v1: &[f32], v2: &[f32]) -> f32 {
    let dot: f32 = v1.iter().zip(v2.iter()).map(|(a, b)| a * b).sum();
    let norm1: f32 = v1.iter().map(|v| v * v).sum::<f32>().sqrt();
    let norm2: f32 = v2.iter().map(|v| v * v).sum::<f32>().sqrt();

    if norm1 == 0.0 || norm2 == 0.0 {
        0.0
    } else {
        dot / (norm1 * norm2)
    }
}

fn simple_hash(text: &str) -> String {
    let mut h: i32 = 0;
    for c in text.chars() {
        h = h.wrapping_mul(31).wrapping_add(c as i32);
    }
    // simple base36 equivalent
    format!("{:x}", h)
}

async fn get_embedding_index_path(
    app_handle: &tauri::AppHandle,
    project_id: &str,
) -> Result<PathBuf, String> {
    let p_dir = get_project_dir(app_handle, project_id).await?;
    Ok(p_dir.join("embeddings.json"))
}

async fn load_index(app_handle: &tauri::AppHandle, project_id: &str) -> EmbeddingIndex {
    if let Ok(path) = get_embedding_index_path(app_handle, project_id).await {
        if let Ok(content) = fs::read_to_string(&path).await {
            if let Ok(index) = serde_json::from_str(&content) {
                return index;
            }
        }
    }
    EmbeddingIndex::default()
}

async fn save_index(
    app_handle: &tauri::AppHandle,
    project_id: &str,
    index: &EmbeddingIndex,
) -> Result<(), String> {
    let path = get_embedding_index_path(app_handle, project_id).await?;
    let json = serde_json::to_string(index).map_err(|e| e.to_string())?;
    fs::write(path, json).await.map_err(|e| e.to_string())
}

async fn get_api_key(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let w_dir = get_workspace_dir(app_handle).await?;
    let config_file = w_dir.join("config.json");
    if let Ok(content) = fs::read_to_string(&config_file).await {
        if let Ok(config) = serde_json::from_str::<HashMap<String, String>>(&content) {
            if let Some(key) = config.get("GEMINI_API_KEY") {
                if !key.is_empty() {
                    return Ok(key.clone());
                }
            }
        }
    }
    if let Ok(key) = std::env::var("GEMINI_API_KEY") {
        return Ok(key);
    }
    Err("Missing GEMINI_API_KEY".to_string())
}

async fn embed_text(api_key: &str, text: &str) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:embedContent?key={}",
        EMBEDDING_MODEL, api_key
    );

    // Truncate text simply
    let truncated: String = text.chars().take(8000).collect();

    let body = serde_json::json!({
        "model": format!("models/{}", EMBEDDING_MODEL),
        "content": {
            "role": "user",
            "parts": [{"text": truncated}]
        }
    });

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("API error: {}", res.status()));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(embedding) = json
        .get("embedding")
        .and_then(|e| e.get("values"))
        .and_then(|v| v.as_array())
    {
        let vec: Vec<f32> = embedding
            .iter()
            .filter_map(|v| v.as_f64().map(|f| f as f32))
            .collect();
        Ok(vec)
    } else {
        Err("No embedding in response".to_string())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub updated: u32,
    pub total: u32,
}

#[tauri::command]
pub async fn update_project_embeddings(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<UpdateResult, String> {
    let api_key = match get_api_key(&app_handle).await {
        Ok(k) => k,
        Err(_) => {
            return Ok(UpdateResult {
                updated: 0,
                total: 0,
            })
        } // fail silently
    };

    let docs = list_documents(app_handle.clone(), project_id.clone())
        .await
        .unwrap_or_default();
    let wikis = list_wiki_entries(app_handle.clone(), project_id.clone())
        .await
        .unwrap_or_default();

    let mut index = load_index(&app_handle, &project_id).await;
    let mut updated = 0;
    let mut total = 0;

    let mut valid_keys = std::collections::HashSet::new();

    for doc in docs {
        let key = format!("doc:{}", doc.id);
        valid_keys.insert(key.clone());
        total += 1;

        let text_to_embed = format!("{}\n{}", doc.title, doc.content);
        let hash = simple_hash(&text_to_embed);

        if let Some(existing) = index.entries.get(&key) {
            if existing.content_hash == hash && !existing.vector.is_empty() {
                continue;
            }
        }

        if let Ok(vector) = embed_text(&api_key, &text_to_embed).await {
            index.entries.insert(
                key,
                EmbeddingEntry {
                    id: doc.id,
                    r#type: "document".to_string(),
                    title: doc.title,
                    vector,
                    content_hash: hash,
                },
            );
            updated += 1;
        }
    }

    for wiki in wikis {
        let key = format!("wiki:{}", wiki.id);
        valid_keys.insert(key.clone());
        total += 1;

        let text_to_embed = format!("{}\n{}", wiki.title, wiki.content);
        let hash = simple_hash(&text_to_embed);

        if let Some(existing) = index.entries.get(&key) {
            if existing.content_hash == hash && !existing.vector.is_empty() {
                continue;
            }
        }

        if let Ok(vector) = embed_text(&api_key, &text_to_embed).await {
            index.entries.insert(
                key,
                EmbeddingEntry {
                    id: wiki.id,
                    r#type: "wiki".to_string(),
                    title: wiki.title,
                    vector,
                    content_hash: hash,
                },
            );
            updated += 1;
        }
    }

    // Embed timeline events
    let timelines = list_timelines(app_handle.clone(), project_id.clone())
        .await
        .unwrap_or_default();
    for tl in timelines {
        for event in &tl.events {
            let key = format!("timeline_event:{}", event.id);
            valid_keys.insert(key.clone());
            total += 1;

            let text_to_embed = format!(
                "{}\n{}\n{}",
                event.title,
                event.content.as_deref().unwrap_or(""),
                event.summary.as_deref().unwrap_or("")
            );
            let hash = simple_hash(&text_to_embed);

            if let Some(existing) = index.entries.get(&key) {
                if existing.content_hash == hash && !existing.vector.is_empty() {
                    continue;
                }
            }

            if let Ok(vector) = embed_text(&api_key, &text_to_embed).await {
                index.entries.insert(
                    key,
                    EmbeddingEntry {
                        id: event.id.clone(),
                        r#type: "timeline_event".to_string(),
                        title: event.title.clone(),
                        vector,
                        content_hash: hash,
                    },
                );
                updated += 1;
            }
        }
    }

    index.entries.retain(|k, _| valid_keys.contains(k));
    let _ = save_index(&app_handle, &project_id, &index).await;

    Ok(UpdateResult { updated, total })
}

#[tauri::command]
pub async fn embed_single_entry(
    app_handle: tauri::AppHandle,
    project_id: String,
    entry_id: String,
    r#type: String,
    title: String,
    content: String,
) -> Result<(), String> {
    let api_key = match get_api_key(&app_handle).await {
        Ok(k) => k,
        Err(_) => return Ok(()),
    };

    let key = match r#type.as_str() {
        "document" => format!("doc:{}", entry_id),
        "timeline_event" => format!("timeline_event:{}", entry_id),
        _ => format!("wiki:{}", entry_id),
    };
    let text_to_embed = format!("{}\n{}", title, content);
    let hash = simple_hash(&text_to_embed);

    let mut index = load_index(&app_handle, &project_id).await;

    if let Some(existing) = index.entries.get(&key) {
        if existing.content_hash == hash && !existing.vector.is_empty() {
            return Ok(());
        }
    }

    if let Ok(vector) = embed_text(&api_key, &text_to_embed).await {
        index.entries.insert(
            key,
            EmbeddingEntry {
                id: entry_id,
                r#type,
                title,
                vector,
                content_hash: hash,
            },
        );
        let _ = save_index(&app_handle, &project_id, &index).await;
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RetrievalResult {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub score: f32,
}

#[tauri::command]
pub async fn retrieve_similar(
    app_handle: tauri::AppHandle,
    project_id: String,
    query: String,
    top_k: usize,
) -> Result<Vec<RetrievalResult>, String> {
    let index = load_index(&app_handle, &project_id).await;
    if index.entries.is_empty() {
        return Ok(vec![]);
    }

    let api_key = match get_api_key(&app_handle).await {
        Ok(k) => k,
        Err(_) => return Ok(vec![]),
    };

    let query_vector = match embed_text(&api_key, &query).await {
        Ok(v) => v,
        Err(_) => return Ok(vec![]),
    };

    if query_vector.is_empty() {
        return Ok(vec![]);
    }

    let mut scored: Vec<RetrievalResult> = index
        .entries
        .values()
        .filter(|e| !e.vector.is_empty())
        .map(|e| {
            let score = cosine_similarity(&query_vector, &e.vector);
            RetrievalResult {
                id: e.id.clone(),
                r#type: e.r#type.clone(),
                title: e.title.clone(),
                score,
            }
        })
        .filter(|r| r.score > 0.3)
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(top_k);

    Ok(scored)
}
