#![cfg_attr(test, allow(clippy::await_holding_lock))]

use super::{Tool, ToolContext, ToolOutput};
use crate::bus::{Bus, BusEvent, SidePanelUpdated};
use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path;

pub struct SidePanelTool;

impl SidePanelTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Deserialize)]
struct SidePanelInput {
    action: String,
    #[serde(default)]
    page_id: Option<String>,
    #[serde(default)]
    file_path: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    focus: Option<bool>,
    #[serde(default)]
    surface_messages: Option<Value>,
    #[serde(default)]
    description: Option<String>,
}

#[async_trait]
impl Tool for SidePanelTool {
    fn name(&self) -> &str {
        "side_panel"
    }

    fn description(&self) -> &str {
        "Manage side panel pages."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["action"],
            "properties": {
                "intent": super::intent_schema_property(),
                "action": {
                    "type": "string",
                    "enum": ["status", "write", "append", "load", "focus", "delete", "write_a2ui", "save_a2ui"],
                    "description": "Action."
                },
                "page_id": {
                    "type": "string",
                    "description": "Page ID."
                },
                "file_path": {
                    "type": "string",
                    "description": "File path."
                },
                "title": {
                    "type": "string",
                    "description": "Page title."
                },
                "content": {
                    "type": "string",
                    "description": "Page content."
                },
                "focus": {
                    "type": "boolean",
                    "description": "Focus the page."
                },
                "surface_messages": {
                    "description": "A2UI surface messages array (JSON). Required for write_a2ui."
                },
                "description": {
                    "type": "string",
                    "description": "Page description (for save_a2ui)."
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let params: SidePanelInput = serde_json::from_value(input)?;
        let action_label = params.action.clone();
        let page_label = params
            .page_id
            .clone()
            .unwrap_or_else(|| "<none>".to_string());
        let file_label = params
            .file_path
            .clone()
            .unwrap_or_else(|| "<none>".to_string());
        let focus = params.focus.unwrap_or(true);

        let snapshot = match params.action.as_str() {
            "status" => crate::side_panel::snapshot_for_session(&ctx.session_id)?,
            "write" => crate::side_panel::write_markdown_page(
                &ctx.session_id,
                params
                    .page_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("page_id is required for write"))?,
                params.title.as_deref(),
                params
                    .content
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("content is required for write"))?,
                focus,
            )?,
            "append" => crate::side_panel::append_markdown_page(
                &ctx.session_id,
                params
                    .page_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("page_id is required for append"))?,
                params.title.as_deref(),
                params
                    .content
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("content is required for append"))?,
                focus,
            )?,
            "load" => {
                let file_path = params
                    .file_path
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("file_path is required for load"))?;
                let resolved = ctx.resolve_path(Path::new(file_path));
                let page_id = params
                    .page_id
                    .clone()
                    .unwrap_or_else(|| derive_page_id(&resolved));
                let title = params.title.clone().or_else(|| {
                    resolved
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                });
                crate::side_panel::load_markdown_file(
                    &ctx.session_id,
                    &page_id,
                    title.as_deref(),
                    &resolved,
                    focus,
                )?
            }
            "focus" => crate::side_panel::focus_page(
                &ctx.session_id,
                params
                    .page_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("page_id is required for focus"))?,
            )?,
            "delete" => crate::side_panel::delete_page(
                &ctx.session_id,
                params
                    .page_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("page_id is required for delete"))?,
            )?,
            "write_a2ui" => {
                let page_id = params
                    .page_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("page_id is required for write_a2ui"))?;
                let messages = params.surface_messages.as_ref().ok_or_else(|| {
                    anyhow::anyhow!("surface_messages is required for write_a2ui")
                })?;
                let content = serde_json::to_string(messages)?;
                crate::side_panel::write_a2ui_page(
                    &ctx.session_id,
                    page_id,
                    params.title.as_deref(),
                    &content,
                    focus,
                )?
            }
            "save_a2ui" => {
                let page_id = params
                    .page_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("page_id is required for save_a2ui"))?;
                // Load the current snapshot to find the page
                let snapshot = crate::side_panel::snapshot_for_session(&ctx.session_id)?;
                let page = snapshot
                    .pages
                    .iter()
                    .find(|p| p.id == page_id)
                    .ok_or_else(|| anyhow::anyhow!("page not found: {}", page_id))?;
                if page.format != jcode_side_panel_types::SidePanelPageFormat::A2ui {
                    anyhow::bail!("page {} is not an A2UI page", page_id);
                }
                let messages: Vec<Value> =
                    serde_json::from_str(&page.content).with_context(|| {
                        format!("failed to parse A2UI content for page {}", page_id)
                    })?;
                crate::a2ui_pages::save_page(&crate::a2ui_pages::SavedA2uiPage {
                    id: page_id.to_string(),
                    title: params.title.clone().unwrap_or_else(|| page.title.clone()),
                    description: params.description.clone(),
                    icon: None,
                    surface_messages: messages,
                    created_at_ms: crate::side_panel::now_ms(),
                    updated_at_ms: crate::side_panel::now_ms(),
                    source_session_id: Some(ctx.session_id.clone()),
                })?;
                // Return the existing snapshot (save doesn't change the side panel)
                snapshot
            }
            other => anyhow::bail!("unknown side_panel action: {}", other),
        };

        if params.action != "status" {
            Bus::global().publish(BusEvent::SidePanelUpdated(SidePanelUpdated {
                session_id: ctx.session_id.clone(),
                snapshot: snapshot.clone(),
            }));
        }

        Ok(ToolOutput::new(crate::side_panel::status_output(&snapshot))
            .with_title("side_panel")
            .with_metadata(serde_json::to_value(&snapshot)?))
        .map_err(|err| {
            crate::logging::warn(&format!(
                "[tool:side_panel] action failed action={} page_id={} file_path={} session_id={} error={}",
                action_label, page_label, file_label, ctx.session_id, err
            ));
            err
        })
    }
}

fn derive_page_id(path: &Path) -> String {
    let raw = path
        .file_stem()
        .or_else(|| path.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "page".to_string());

    let mut page_id = String::new();
    let mut prev_dash = false;
    for ch in raw.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() || matches!(lower, '_' | '.') {
            page_id.push(lower);
            prev_dash = false;
        } else if !prev_dash {
            page_id.push('-');
            prev_dash = true;
        }
    }

    let page_id = page_id.trim_matches('-').trim_matches('.').to_string();
    if page_id.is_empty() {
        "page".to_string()
    } else {
        page_id
    }
}

#[cfg(test)]
#[path = "side_panel_tests.rs"]
mod side_panel_tests;
