use crate::commands::*;
use crate::error::TauriError;
use crate::server_client::ServerClient;
use crate::utils::*;
use jcode::protocol::ServerEvent;
use jcode::provider::Provider;
use jcode::session::Session;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_workspace_memory_preferences() -> Result<serde_json::Value, String> {
    let cfg = jcode::config::Config::load();
    Ok(serde_json::json!({
        "default_enabled": cfg.workspace_memory.default_enabled.unwrap_or(cfg.features.memory),
        "workspaces": cfg.workspace_memory.workspaces,
    }))
}
#[tauri::command]
pub async fn set_workspace_memory_preference(
    working_dir: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    jcode::config::Config::set_workspace_memory_enabled(working_dir.as_deref(), enabled)
        .map_err(|e| format!("Failed to save workspace memory preference: {e}"))
}
#[tauri::command]
pub fn get_memory_list(scope: String, tag: Option<String>) -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();
    let mut all_memories: Vec<serde_json::Value> = Vec::new();

    if scope == "all" || scope == "project" {
        if let Ok(graph) = manager.load_project_graph() {
            for entry in graph.all_memories() {
                all_memories.push(memory_entry_to_json(entry));
            }
        }
    }
    if scope == "all" || scope == "global" {
        if let Ok(graph) = manager.load_global_graph() {
            for entry in graph.all_memories() {
                all_memories.push(memory_entry_to_json(entry));
            }
        }
    }

    if let Some(tag_filter) = tag {
        all_memories.retain(|m| {
            m.get("tags")
                .and_then(|t| t.as_array())
                .map(|arr| arr.iter().any(|t| t.as_str() == Some(&tag_filter)))
                .unwrap_or(false)
        });
    }

    // Sort by updated_at descending
    all_memories.sort_by(|a, b| {
        let a_ts = a.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
        let b_ts = b.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
        b_ts.cmp(a_ts)
    });

    Ok(serde_json::json!({ "memories": all_memories }))
}
fn memory_entry_to_json(entry: &jcode::memory_types::MemoryEntry) -> serde_json::Value {
    serde_json::json!({
        "id": entry.id,
        "category": entry.category.to_string(),
        "content": entry.content,
        "tags": entry.tags,
        "created_at": entry.created_at.to_rfc3339(),
        "updated_at": entry.updated_at.to_rfc3339(),
        "access_count": entry.access_count,
        "source": entry.source,
        "trust": format!("{:?}", entry.trust).to_lowercase(),
        "strength": entry.strength,
        "active": entry.active,
        "superseded_by": entry.superseded_by,
        "confidence": entry.confidence,
        "effective_confidence": entry.effective_confidence(),
    })
}
#[tauri::command]
pub fn search_memories(query: String, semantic: bool) -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();
    let mut results: Vec<serde_json::Value> = Vec::new();

    if semantic {
        match manager.find_similar(&query, 0.3, 20) {
            Ok(found) => {
                for (entry, score) in found {
                    let mut json = memory_entry_to_json(&entry);
                    if let Some(obj) = json.as_object_mut() {
                        obj.insert("score".to_string(), serde_json::json!(score));
                    }
                    results.push(json);
                }
            }
            Err(e) => return Err(format!("Semantic search failed: {e}")),
        }
    } else {
        match manager.search(&query) {
            Ok(found) => {
                for entry in found {
                    results.push(memory_entry_to_json(&entry));
                }
            }
            Err(e) => return Err(format!("Keyword search failed: {e}")),
        }
    }

    Ok(serde_json::json!({ "results": results }))
}
#[tauri::command]
pub fn get_memory_stats() -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();
    let mut project_count = 0usize;
    let mut global_count = 0usize;
    let mut total_tags = std::collections::HashSet::<String>::new();
    let mut categories: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    if let Ok(graph) = manager.load_project_graph() {
        project_count = graph.memory_count();
        for entry in graph.all_memories() {
            for tag in &entry.tags {
                total_tags.insert(tag.clone());
            }
            *categories.entry(entry.category.to_string()).or_default() += 1;
        }
    }

    if let Ok(graph) = manager.load_global_graph() {
        global_count = graph.memory_count();
        for entry in graph.all_memories() {
            for tag in &entry.tags {
                total_tags.insert(tag.clone());
            }
            *categories.entry(entry.category.to_string()).or_default() += 1;
        }
    }

    Ok(serde_json::json!({
        "project_count": project_count,
        "global_count": global_count,
        "total": project_count + global_count,
        "unique_tags": total_tags.len(),
        "categories": categories,
    }))
}
#[tauri::command]
pub fn get_memory_graph() -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    use jcode::tui::info_widget::build_graph_topology;

    let manager = MemoryManager::new();

    let project_graph = manager.load_project_graph().ok();
    let global_graph = manager.load_global_graph().ok();

    let (nodes, edges) = build_graph_topology(project_graph.as_ref(), global_graph.as_ref());

    // GraphNode and GraphEdge already derive Serialize (see jcode-tui-core).
    let node_values: Vec<serde_json::Value> = nodes
        .into_iter()
        .map(|n| {
            serde_json::json!({
                "id": n.id,
                "label": n.label,
                "kind": n.kind,
                "is_memory": n.is_memory,
                "is_active": n.is_active,
                "confidence": n.confidence,
                "degree": n.degree,
            })
        })
        .collect();

    let edge_values: Vec<serde_json::Value> = edges
        .into_iter()
        .map(|e| {
            serde_json::json!({
                "source": e.source,
                "target": e.target,
                "kind": e.kind,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "nodes": node_values,
        "edges": edge_values,
    }))
}
#[tauri::command]
pub fn export_memories(path: String) -> Result<(), String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();

    let project_graph = manager
        .load_project_graph()
        .map_err(|e| format!("Failed to load project memories: {e}"))?;
    let global_graph = manager
        .load_global_graph()
        .map_err(|e| format!("Failed to load global memories: {e}"))?;

    let export = serde_json::json!({
        "version": 1,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "project_memories": project_graph.all_memories().collect::<Vec<_>>(),
        "global_memories": global_graph.all_memories().collect::<Vec<_>>(),
    });

    std::fs::write(
        &path,
        serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write export file: {e}"))?;

    Ok(())
}
#[tauri::command]
pub fn import_memories(path: String) -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read import file: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse import file: {e}"))?;

    let mut project_count = 0usize;
    let mut global_count = 0usize;

    if let Some(entries) = value.get("project_memories").and_then(|v| v.as_array()) {
        let mut graph = manager
            .load_project_graph()
            .map_err(|e| format!("Failed to load project graph: {e}"))?;
        for entry_value in entries {
            if let Ok(entry) =
                serde_json::from_value::<jcode::memory_types::MemoryEntry>(entry_value.clone())
            {
                manager.upsert_memory_in_graph(&mut graph, entry);
                project_count += 1;
            }
        }
        manager
            .save_project_graph(&graph)
            .map_err(|e| format!("Failed to save project graph: {e}"))?;
    }

    if let Some(entries) = value.get("global_memories").and_then(|v| v.as_array()) {
        let mut graph = manager
            .load_global_graph()
            .map_err(|e| format!("Failed to load global graph: {e}"))?;
        for entry_value in entries {
            if let Ok(entry) =
                serde_json::from_value::<jcode::memory_types::MemoryEntry>(entry_value.clone())
            {
                manager.upsert_memory_in_graph(&mut graph, entry);
                global_count += 1;
            }
        }
        manager
            .save_global_graph(&graph)
            .map_err(|e| format!("Failed to save global graph: {e}"))?;
    }

    Ok(serde_json::json!({
        "project_count": project_count,
        "global_count": global_count,
    }))
}
#[tauri::command]
pub fn clear_test_memories() -> Result<serde_json::Value, String> {
    use jcode::storage;
    let test_dir = storage::jcode_dir()
        .map_err(|e| format!("Failed to resolve jcode dir: {e}"))?
        .join("memory")
        .join("test");
    if !test_dir.exists() {
        return Ok(serde_json::json!({ "count": 0 }));
    }
    let count = std::fs::read_dir(&test_dir)
        .map_err(|e| format!("Failed to read test memory dir: {e}"))?
        .count();
    std::fs::remove_dir_all(&test_dir)
        .map_err(|e| format!("Failed to clear test memory storage: {e}"))?;
    Ok(serde_json::json!({ "count": count }))
}
