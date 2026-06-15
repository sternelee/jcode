use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedA2uiPage {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub surface_messages: Vec<serde_json::Value>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub source_session_id: Option<String>,
}

fn pages_dir() -> Result<PathBuf> {
    let dir = crate::storage::jcode_dir()?.join("a2ui_pages");
    crate::storage::ensure_dir(&dir)?;
    Ok(dir)
}

fn page_path(page_id: &str) -> Result<PathBuf> {
    // Sanitize page_id to prevent path traversal
    if page_id.contains("..") || page_id.contains('/') || page_id.contains('\\') {
        anyhow::bail!("invalid a2ui page id: {}", page_id);
    }
    Ok(pages_dir()?.join(format!("{}.json", page_id)))
}

pub fn save_page(page: &SavedA2uiPage) -> Result<()> {
    let path = page_path(&page.id)?;
    crate::storage::write_json_fast(&path, page)
        .with_context(|| format!("failed to save a2ui page {}", page.id))
}

pub fn load_page(page_id: &str) -> Result<SavedA2uiPage> {
    let path = page_path(page_id)?;
    if !path.exists() {
        anyhow::bail!("a2ui page not found: {}", page_id);
    }
    crate::storage::read_json(&path).with_context(|| format!("failed to load a2ui page {}", page_id))
}

pub fn list_pages() -> Result<Vec<SavedA2uiPage>> {
    let dir = pages_dir()?;
    let mut pages = Vec::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(pages),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            match crate::storage::read_json::<SavedA2uiPage>(&path) {
                Ok(page) => pages.push(page),
                Err(e) => {
                    crate::logging::warn(&format!(
                        "skipping corrupt a2ui page {}: {}",
                        path.display(),
                        e
                    ));
                }
            }
        }
    }
    pages.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(pages)
}

pub fn delete_page(page_id: &str) -> Result<()> {
    let path = page_path(page_id)?;
    if !path.exists() {
        anyhow::bail!("a2ui page not found: {}", page_id);
    }
    std::fs::remove_file(&path)
        .with_context(|| format!("failed to delete a2ui page {}", page_id))
}
