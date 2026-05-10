pub mod commands;

use commands::{create_agent_with_session, create_provider, setup_stdin_channel, AppState, SessionRuntime};
use jcode::message::{ContentBlock, Role, ToolCall};
use jcode::protocol::ServerEvent;
use jcode::provider::Provider;
use jcode::session::{Session, StoredDisplayRole, StoredMessage};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, State};

const DEFAULT_VISIBLE_COMPACTED_HISTORY_MESSAGES: usize = 64;
const SESSION_PREVIEW_LINE_LIMIT: usize = 3;
const SESSION_PREVIEW_CHAR_LIMIT: usize = 72;
const SESSION_DETAIL_LINE_LIMIT: usize = 8;
const SESSION_DETAIL_CHAR_LIMIT: usize = 128;

fn is_internal_system_reminder(message: &StoredMessage) -> bool {
    message
        .content
        .iter()
        .find_map(|block| match block {
            ContentBlock::Text { text, .. } => Some(text.trim_start()),
            _ => None,
        })
        .is_some_and(|text| text.starts_with("<system-reminder>"))
}

fn message_role(message: &StoredMessage) -> &'static str {
    match message.display_role {
        Some(StoredDisplayRole::System) | Some(StoredDisplayRole::BackgroundTask) => "system",
        None => match message.role {
            Role::User => "user",
            Role::Assistant => "assistant",
        },
    }
}

fn fallback_image_label(tool: &ToolCall) -> Option<String> {
    tool.input
        .get("file_path")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn push_desktop_message(
    messages: &mut Vec<serde_json::Value>,
    role: &str,
    content: &mut String,
    tool_calls: &mut Vec<String>,
    tool_data: &mut Option<ToolCall>,
    images: &mut Vec<serde_json::Value>,
) {
    if content.is_empty() && tool_data.is_none() && images.is_empty() && tool_calls.is_empty() {
        return;
    }

    messages.push(serde_json::json!({
        "role": role,
        "content": std::mem::take(content),
        "tool_calls": (!tool_calls.is_empty()).then_some(std::mem::take(tool_calls)),
        "tool_data": tool_data.take(),
        "images": std::mem::take(images),
    }));
}

fn serialize_model_route(route: jcode::provider::ModelRoute) -> serde_json::Value {
    let model = route.model;
    let provider = route.provider;
    let api_method = route.api_method;
    let available = route.available;
    let detail = route.detail;
    let cheapness = route.cheapness;
    let display_name = model.clone();
    let context_window = jcode::provider::context_limit_for_model_with_provider(
        &model,
        Some(&provider),
    );
    serde_json::json!({
        "provider": provider,
        "model": model,
        "api_method": api_method,
        "available": available,
        "detail": detail,
        "display_name": display_name,
        "context_window": context_window,
        "cheapness": cheapness,
    })
}

fn auth_state_label(state: jcode::auth::AuthState) -> &'static str {
    match state {
        jcode::auth::AuthState::Available => "available",
        jcode::auth::AuthState::Expired => "expired",
        jcode::auth::AuthState::NotConfigured => "not_configured",
    }
}

fn provider_config_options(provider_key: &str) -> Option<Vec<serde_json::Value>> {
    if let Some(descriptor) = jcode::provider_catalog::resolve_login_provider(provider_key) {
        return match descriptor.target {
            jcode::provider_catalog::LoginProviderTarget::Claude => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "oauth",
                "label": "Sign in with Claude",
                "detail": "OAuth login for Claude subscription access",
            })]),
            jcode::provider_catalog::LoginProviderTarget::OpenAi => Some(vec![
                serde_json::json!({
                    "provider_id": descriptor.id,
                    "kind": "oauth",
                    "label": "Sign in with OpenAI",
                    "detail": "Use ChatGPT Plus/Pro OAuth access",
                }),
                serde_json::json!({
                    "provider_id": "openai-api",
                    "kind": "api_key",
                    "label": "Save OpenAI API key",
                    "detail": "Use a native OpenAI platform API key",
                    "setup_url": "https://platform.openai.com/api-keys",
                    "input_label": "OPENAI_API_KEY",
                    "input_placeholder": "sk-...",
                }),
            ]),
            jcode::provider_catalog::LoginProviderTarget::OpenRouter => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "api_key",
                "label": "Save OpenRouter API key",
                "detail": "Configure pay-per-token OpenRouter access",
                "setup_url": "https://openrouter.ai/keys",
                "input_label": "OPENROUTER_API_KEY",
                "input_placeholder": "sk-or-v1-...",
            })]),
            jcode::provider_catalog::LoginProviderTarget::OpenAiCompatible(profile) => {
                let resolved = jcode::provider_catalog::resolve_openai_compatible_profile(profile);
                Some(vec![serde_json::json!({
                    "provider_id": descriptor.id,
                    "kind": "api_key",
                    "label": format!("Save {} API key", resolved.display_name),
                    "detail": if resolved.requires_api_key {
                        format!("Configure {} via {}", resolved.display_name, resolved.api_key_env)
                    } else {
                        format!("Configure {} local/OpenAI-compatible endpoint", resolved.display_name)
                    },
                    "setup_url": resolved.setup_url,
                    "input_label": resolved.api_key_env,
                    "input_placeholder": if resolved.api_key_env.contains("OPENROUTER") {
                        "sk-or-v1-..."
                    } else {
                        "Paste API key"
                    },
                })])
            }
            jcode::provider_catalog::LoginProviderTarget::Bedrock => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "api_key",
                "label": "Save Bedrock API key",
                "detail": "Requires an API key plus AWS region",
                "setup_url": "https://console.aws.amazon.com/bedrock/home#/api-keys",
                "input_label": "BEDROCK_API_KEY",
                "input_placeholder": "bedrock-...",
                "extra_fields": [{
                    "key": "region",
                    "label": "AWS region",
                    "placeholder": "us-east-2",
                    "default_value": "us-east-2",
                }],
            })]),
            jcode::provider_catalog::LoginProviderTarget::Cursor => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "api_key",
                "label": "Save Cursor API key",
                "detail": "Use the native Cursor HTTPS transport",
                "setup_url": "https://cursor.com/settings",
                "input_label": "CURSOR_API_KEY",
                "input_placeholder": "cursor_...",
            })]),
            jcode::provider_catalog::LoginProviderTarget::Copilot => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "device_code",
                "label": "Start GitHub device login",
                "detail": "Open GitHub and confirm the device code",
            })]),
            jcode::provider_catalog::LoginProviderTarget::Gemini => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "oauth",
                "label": "Sign in with Gemini",
                "detail": "Google Gemini Code Assist OAuth login",
            })]),
            jcode::provider_catalog::LoginProviderTarget::Antigravity => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "oauth",
                "label": "Sign in with Antigravity",
                "detail": "Google Antigravity OAuth login",
            })]),
            jcode::provider_catalog::LoginProviderTarget::Jcode => Some(vec![serde_json::json!({
                "provider_id": descriptor.id,
                "kind": "api_key",
                "label": "Save Jcode API key",
                "detail": "Configure curated Jcode router access",
                "input_label": "JCODE_API_KEY",
                "input_placeholder": "jcode_...",
            })]),
            _ => None,
        };
    }

    match provider_key {
        "anthropic" | "claude" => Some(vec![serde_json::json!({
            "provider_id": "claude",
            "kind": "oauth",
            "label": "Sign in with Claude",
            "detail": "OAuth login for Claude subscription access",
        })]),
        _ => None,
    }
}

fn direct_config_provider_id(provider_key: &str) -> Option<String> {
    let trimmed = provider_key.trim();
    if trimmed.is_empty() || trimmed == "—" {
        return None;
    }

    if let Some(provider) = jcode::provider_catalog::resolve_login_provider(trimmed) {
        return Some(provider.id.to_string());
    }

    let normalized = trimmed.to_ascii_lowercase();
    match normalized.as_str() {
        "anthropic" => return Some("claude".to_string()),
        "openai" => return Some("openai".to_string()),
        "cursor" => return Some("cursor".to_string()),
        "copilot" | "github copilot" => return Some("copilot".to_string()),
        "gemini" | "google gemini" => return Some("gemini".to_string()),
        "antigravity" => return Some("antigravity".to_string()),
        "aws bedrock" | "bedrock" => return Some("bedrock".to_string()),
        "jcode" | "jcode subscription" => return Some("jcode".to_string()),
        _ => {}
    }

    None
}

fn auth_provider_id_for_route(provider_key: &str, api_method: Option<&str>) -> Option<String> {
    if let Some(provider_id) = direct_config_provider_id(provider_key) {
        return Some(provider_id);
    }

    let trimmed = provider_key.trim();
    if let Some(profile_id) = jcode::provider_catalog::openai_compatible_profile_id_for_display_name(trimmed) {
        return Some(profile_id.to_string());
    }

    let trimmed = provider_key.trim();
    if trimmed.is_empty() || trimmed == "—" {
        if api_method.is_some_and(|method| method.contains("openrouter")) {
            return Some("openrouter".to_string());
        }
        return None;
    }

    let normalized = trimmed.to_ascii_lowercase();
    if normalized == "auto" && api_method.is_some_and(|method| method.contains("openrouter")) {
        return Some("openrouter".to_string());
    }

    if api_method.is_some_and(|method| method.contains("openrouter")) {
        return Some("openrouter".to_string());
    }

    None
}

fn provider_summary_descriptor(
    provider_key: &str,
) -> Option<jcode::provider_catalog::LoginProviderDescriptor> {
    let auth_provider_id = direct_config_provider_id(provider_key)?;
    jcode::provider_catalog::resolve_login_provider(&auth_provider_id)
}

fn auth_owner_descriptor(
    auth_provider_id: Option<&str>,
) -> Option<jcode::provider_catalog::LoginProviderDescriptor> {
    auth_provider_id.and_then(jcode::provider_catalog::resolve_login_provider)
}

fn provider_catalog_entry(
    provider_key: &str,
    route_count: usize,
    api_method: Option<&str>,
    is_current_provider: bool,
    auth_status: &jcode::auth::AuthStatus,
) -> serde_json::Value {
    let auth_provider_id = auth_provider_id_for_route(provider_key, api_method);
    let direct_provider_id = direct_config_provider_id(provider_key);
    let options = direct_provider_id
        .as_deref()
        .and_then(provider_config_options)
        .unwrap_or_default();
    let auth_owner = auth_owner_descriptor(auth_provider_id.as_deref());
    if let Some(descriptor) = provider_summary_descriptor(provider_key) {
        let state = auth_status.state_for_provider(descriptor);
        let method_detail = auth_status.method_detail_for_provider(descriptor);
        return serde_json::json!({
            "provider_key": provider_key,
            "auth_provider_id": auth_provider_id,
            "display_name": descriptor.display_name,
            "has_config_surface": true,
            "configured": matches!(state, jcode::auth::AuthState::Available),
            "status": auth_state_label(state),
            "method_detail": method_detail,
            "route_count": route_count,
            "is_current_provider": is_current_provider,
            "options": options,
        });
    }

    let owner_state = auth_owner.map(|descriptor| auth_status.state_for_provider(descriptor));
    let owner_label = auth_owner.map(|descriptor| descriptor.display_name.to_string());
    serde_json::json!({
        "provider_key": provider_key,
        "auth_provider_id": auth_provider_id,
        "display_name": provider_key,
        "has_config_surface": false,
        "configured": matches!(owner_state, Some(jcode::auth::AuthState::Available)),
        "status": owner_state.map(auth_state_label).unwrap_or("unknown"),
        "method_detail": owner_label
            .map(|label| format!("via {label}"))
            .or_else(|| api_method.map(|method| format!("provider-specific route via {method}")))
            .unwrap_or_else(|| "provider-specific configuration".to_string()),
        "route_count": route_count,
        "is_current_provider": false,
        "options": options,
    })
}

fn provider_entries_from_routes(
    routes: &[jcode::provider::ModelRoute],
    current_provider: Option<&str>,
) -> Vec<serde_json::Value> {
    let auth_status = jcode::auth::AuthStatus::check();
    let current_auth_provider_id = current_provider.and_then(|provider| auth_provider_id_for_route(provider, None));
    let mut grouped: HashMap<String, (usize, Option<String>)> = HashMap::new();
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    let mut current_provider_matched = false;

    for route in routes {
        let route_key = direct_config_provider_id(&route.provider).unwrap_or_else(|| route.provider.clone());
        let route_api_method = Some(route.api_method.clone());
        let entry = grouped.entry(route_key.clone()).or_insert_with(|| {
            if seen.insert(route_key.clone()) {
                ordered.push(route_key.clone());
            }
            (0usize, route_api_method.clone())
        });
        if entry.1.is_none() {
            entry.1 = route_api_method;
        }
        entry.0 += 1;

        let route_auth_provider_id = auth_provider_id_for_route(&route.provider, Some(&route.api_method));
        if let Some(owner_key) = route_auth_provider_id.clone() {
            let owner_entry = grouped.entry(owner_key.clone()).or_insert_with(|| {
                if seen.insert(owner_key.clone()) {
                    ordered.push(owner_key.clone());
                }
                (0usize, None)
            });
            if owner_entry.1.is_none() {
                owner_entry.1 = None;
            }
        }
        if !current_provider_matched && route_auth_provider_id.is_some() && route_auth_provider_id == current_auth_provider_id {
            current_provider_matched = true;
        }
    }

    if let Some(provider) = current_provider {
        if !current_provider_matched {
            let provider_key = direct_config_provider_id(provider).unwrap_or_else(|| provider.to_string());
            let provider_entry = grouped.entry(provider_key.clone()).or_insert_with(|| {
                if seen.insert(provider_key.clone()) {
                    ordered.push(provider_key.clone());
                }
                (0usize, None)
            });
            if provider_entry.1.is_none() {
                provider_entry.1 = None;
            }
        }
    }

    let mut entries: Vec<serde_json::Value> = ordered
        .into_iter()
        .map(|provider_key| {
            let (route_count, api_method) = grouped
                .get(&provider_key)
                .cloned()
                .unwrap_or((0usize, None));
            let is_current_provider = direct_config_provider_id(&provider_key)
                .is_some_and(|provider_id| Some(provider_id) == current_auth_provider_id);
            provider_catalog_entry(
                &provider_key,
                route_count,
                api_method.as_deref(),
                is_current_provider,
                &auth_status,
            )
        })
        .collect();

    entries.sort_by(|a, b| {
        let a_current = a
            .get("is_current_provider")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let b_current = b
            .get("is_current_provider")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if a_current != b_current {
            return b_current.cmp(&a_current);
        }

        let a_configured = a
            .get("configured")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let b_configured = b
            .get("configured")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        if a_configured != b_configured {
            return b_configured.cmp(&a_configured);
        }

        let a_name = a
            .get("display_name")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let b_name = b
            .get("display_name")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        a_name.cmp(b_name)
    });

    entries
}

fn jcode_cli_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("JCODE_DESKTOP_CLI_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }
    candidates.push(PathBuf::from("jcode"));
    if let Ok(home) = std::env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join(".local/bin/jcode"));
        }
    }
    candidates
}

fn run_jcode_json_command(args: &[String]) -> Result<serde_json::Value, String> {
    let mut last_error: Option<String> = None;

    for candidate in jcode_cli_candidates() {
        match Command::new(&candidate).args(args).output() {
            Ok(output) => {
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let message = if !stderr.is_empty() { stderr } else { stdout };
                    return Err(if message.is_empty() {
                        format!("`{}` exited with {}", candidate.display(), output.status)
                    } else {
                        message
                    });
                }

                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if stdout.is_empty() {
                    return Err(format!("`{}` returned no JSON output", candidate.display()));
                }
                return serde_json::from_str::<serde_json::Value>(&stdout)
                    .map_err(|err| format!("Failed to parse login JSON: {err}. Output: {stdout}"));
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                last_error = Some(format!("`{}` not found", candidate.display()));
            }
            Err(err) => {
                return Err(format!("Failed to run `{}`: {err}", candidate.display()));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Unable to find jcode CLI".to_string()))
}

async fn refresh_active_runtime_auth(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<(), String> {
    let runtime = active_runtime(state).await?;
    let provider = { runtime.agent.lock().await.provider_handle() };
    provider.on_auth_changed();
    let _ = provider.prefetch_models().await;
    emit_runtime_snapshot(app_handle, &runtime).await
}

fn desktop_history_messages(session: &Session) -> Vec<serde_json::Value> {
    let mut messages = Vec::new();
    let mut tool_map: HashMap<String, ToolCall> = HashMap::new();

    let compacted_count = session
        .compaction
        .as_ref()
        .map(|state| state.compacted_count.min(session.messages.len()))
        .unwrap_or(0);
    let visible_compacted = DEFAULT_VISIBLE_COMPACTED_HISTORY_MESSAGES.min(compacted_count);
    let render_start_idx = compacted_count.saturating_sub(visible_compacted);
    let remaining_compacted = render_start_idx;

    if compacted_count > 0 {
        let content = if remaining_compacted == 0 {
            format!(
                "Earlier conversation compacted — showing all {} compacted historical messages. Redraw may be slower while this view is open.",
                compacted_count
            )
        } else if visible_compacted == 0 {
            format!(
                "Earlier conversation compacted — {} historical messages hidden from the UI. Scroll to the top to load older history.",
                compacted_count
            )
        } else {
            format!(
                "Earlier conversation compacted — {} older historical messages hidden. Showing {} of {} compacted messages. Scroll to the top to load more.",
                remaining_compacted, visible_compacted, compacted_count
            )
        };
        messages.push(serde_json::json!({
            "role": "system",
            "content": content,
            "images": Vec::<serde_json::Value>::new(),
        }));
    }

    for message in session.messages.iter().skip(render_start_idx) {
        if is_internal_system_reminder(message) {
            continue;
        }

        let base_role = message_role(message);
        let mut pending_role = base_role;
        let mut pending_text = String::new();
        let mut pending_tool_calls: Vec<String> = Vec::new();
        let mut pending_tool_data: Option<ToolCall> = None;
        let mut pending_images: Vec<serde_json::Value> = Vec::new();
        let mut current_tool: Option<ToolCall> = None;

        for block in &message.content {
            match block {
                ContentBlock::Text { text, .. } => pending_text.push_str(text),
                ContentBlock::ToolUse { id, name, input } => {
                    let tool_call = ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                        intent: ToolCall::intent_from_input(input),
                    };
                    tool_map.insert(id.clone(), tool_call);
                    pending_tool_calls.push(name.clone());
                }
                ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    ..
                } => {
                    push_desktop_message(
                        &mut messages,
                        pending_role,
                        &mut pending_text,
                        &mut pending_tool_calls,
                        &mut pending_tool_data,
                        &mut pending_images,
                    );
                    pending_role = "assistant";
                    pending_text = content.clone();
                    pending_tool_data = tool_map.get(tool_use_id).cloned().or_else(|| {
                        Some(ToolCall {
                            id: tool_use_id.clone(),
                            name: "tool".to_string(),
                            input: serde_json::Value::Null,
                            intent: None,
                        })
                    });
                    current_tool = pending_tool_data.clone();
                }
                ContentBlock::Image { media_type, data } => {
                    pending_images.push(serde_json::json!({
                        "media_type": media_type,
                        "data": data,
                        "label": current_tool.as_ref().and_then(fallback_image_label),
                    }));
                }
                ContentBlock::Reasoning { .. } | ContentBlock::OpenAICompaction { .. } => {}
            }
        }

        push_desktop_message(
            &mut messages,
            pending_role,
            &mut pending_text,
            &mut pending_tool_calls,
            &mut pending_tool_data,
            &mut pending_images,
        );
    }

    messages
}

#[derive(Debug)]
struct SessionFileCandidate {
    path: PathBuf,
    modified: SystemTime,
}

fn session_file_candidate(path: PathBuf) -> Option<SessionFileCandidate> {
    let file_name = path.file_name()?.to_string_lossy();
    if !file_name.ends_with(".json") || file_name.ends_with(".journal.json") {
        return None;
    }

    let modified = path
        .metadata()
        .and_then(|metadata| metadata.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    Some(SessionFileCandidate { path, modified })
}

fn latest_swarm_status_summary(
    value: &Value,
    session_id: &str,
) -> Option<(String, Option<String>, Option<String>, usize)> {
    let replay_events = value.get("replay_events")?.as_array()?;
    for event in replay_events.iter().rev() {
        if event.get("event").and_then(Value::as_str) != Some("swarm_status") {
            continue;
        }
        let members = event.get("members")?.as_array()?;
        let peer_count = members.len();
        for member in members {
            if member.get("session_id").and_then(Value::as_str) != Some(session_id) {
                continue;
            }
            let status = member
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "ready".to_string());
            let detail = member
                .get("detail")
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|text| !text.trim().is_empty());
            let role = member
                .get("role")
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|text| !text.trim().is_empty());
            return Some((status, detail, role, peer_count));
        }
        break;
    }
    None
}

fn plan_priority_rank(priority: &str) -> u8 {
    match priority.to_ascii_lowercase().as_str() {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    }
}

fn plan_status_rank(status: &str, blocked: bool) -> u8 {
    let normalized = status.trim().to_ascii_lowercase();
    if matches!(normalized.as_str(), "running" | "running_stale") {
        0
    } else if blocked {
        2
    } else if matches!(normalized.as_str(), "queued" | "ready" | "pending" | "todo") {
        1
    } else if matches!(normalized.as_str(), "completed" | "done") {
        4
    } else {
        3
    }
}

fn summarize_swarm_plan_items(
    swarm_id: &str,
    version: u64,
    participants: Vec<String>,
    reason: Option<String>,
    items: Vec<serde_json::Value>,
    summary_override: Option<&jcode::protocol::PlanGraphStatus>,
) -> serde_json::Value {
    let completed_ids = items
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.trim();
            let status = item.get("status")?.as_str()?.trim().to_ascii_lowercase();
            matches!(status.as_str(), "completed" | "done").then(|| id.to_string())
        })
        .collect::<std::collections::HashSet<_>>();

    let mut ready_count = 0usize;
    let mut active_count = 0usize;
    let mut blocked_count = 0usize;
    let mut completed_count = 0usize;
    let mut next_ready_ids = Vec::new();
    let mut preview_items: Vec<(u8, u8, serde_json::Value)> = Vec::new();

    for item in &items {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .unwrap_or("task");
        let content = item
            .get("content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .unwrap_or("untitled task");
        let status = item
            .get("status")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .unwrap_or("queued");
        let priority = item
            .get("priority")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .unwrap_or("medium");
        let blocked_by = item
            .get("blocked_by")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let unresolved_dependencies = blocked_by.iter().any(|dep| !completed_ids.contains(dep));
        let normalized_status = status.to_ascii_lowercase();
        let is_completed = matches!(normalized_status.as_str(), "completed" | "done");
        let is_active = matches!(normalized_status.as_str(), "running" | "running_stale");
        let is_runnable = matches!(normalized_status.as_str(), "queued" | "ready" | "pending" | "todo");
        let is_blocked = normalized_status == "blocked" || (!is_completed && !is_active && unresolved_dependencies);

        if is_completed {
            completed_count += 1;
        } else if is_active {
            active_count += 1;
        } else if is_blocked {
            blocked_count += 1;
        } else if is_runnable {
            ready_count += 1;
            next_ready_ids.push(id.to_string());
        }

        preview_items.push((
            plan_status_rank(status, is_blocked),
            plan_priority_rank(priority),
            serde_json::json!({
                "id": id,
                "content": truncate_chars(content, 96),
                "status": status,
                "priority": priority,
                "assigned_to": item.get("assigned_to").and_then(Value::as_str),
                "subsystem": item.get("subsystem").and_then(Value::as_str),
                "blocked_by": blocked_by,
                "file_scope": item
                    .get("file_scope")
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::trim)
                            .filter(|text| !text.is_empty())
                            .map(|text| truncate_chars(text, 48))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
            }),
        ));
    }

    preview_items.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let items_preview = preview_items
        .into_iter()
        .take(8)
        .map(|(_, _, item)| item)
        .collect::<Vec<_>>();

    serde_json::json!({
        "swarm_id": swarm_id,
        "version": version,
        "item_count": summary_override.map_or(items.len(), |summary| summary.item_count),
        "participant_ids": participants,
        "participant_count": participants.len(),
        "reason": reason,
        "ready_count": summary_override.map_or(ready_count, |summary| summary.ready_ids.len()),
        "active_count": summary_override.map_or(active_count, |summary| summary.active_ids.len()),
        "blocked_count": summary_override.map_or(blocked_count, |summary| summary.blocked_ids.len()),
        "completed_count": summary_override.map_or(completed_count, |summary| summary.completed_ids.len()),
        "next_ready_ids": summary_override
            .map(|summary| summary.next_ready_ids.iter().take(4).cloned().collect::<Vec<_>>())
            .unwrap_or_else(|| next_ready_ids.into_iter().take(4).collect::<Vec<_>>()),
        "items_preview": items_preview,
    })
}

fn summarize_swarm_proposal(
    swarm_id: &str,
    proposer_session: &str,
    proposer_name: Option<String>,
    summary: String,
    proposal_key: String,
    items: Vec<serde_json::Value>,
) -> serde_json::Value {
    let item_count = items.len();
    let items_preview = items
        .into_iter()
        .map(|item| {
            serde_json::json!({
                "id": item.get("id").and_then(Value::as_str).unwrap_or("task"),
                "content": truncate_chars(item.get("content").and_then(Value::as_str).unwrap_or("untitled task"), 96),
                "status": item.get("status").and_then(Value::as_str).unwrap_or("queued"),
                "priority": item.get("priority").and_then(Value::as_str).unwrap_or("medium"),
                "assigned_to": item.get("assigned_to").and_then(Value::as_str),
                "subsystem": item.get("subsystem").and_then(Value::as_str),
                "blocked_by": item.get("blocked_by").and_then(Value::as_array).cloned().unwrap_or_default(),
                "file_scope": item.get("file_scope").and_then(Value::as_array).cloned().unwrap_or_default(),
            })
        })
        .take(8)
        .collect::<Vec<_>>();

    serde_json::json!({
        "swarm_id": swarm_id,
        "proposer_session": proposer_session,
        "proposer_name": proposer_name,
        "summary": summary,
        "proposal_key": proposal_key,
        "item_count": item_count,
        "items_preview": items_preview,
    })
}

fn latest_swarm_plan_summary(value: &Value) -> Option<serde_json::Value> {
    let replay_events = value.get("replay_events")?.as_array()?;
    for event in replay_events.iter().rev() {
        if event.get("event").and_then(Value::as_str) != Some("swarm_plan") {
            continue;
        }

        let swarm_id = event.get("swarm_id")?.as_str()?.trim().to_string();
        if swarm_id.is_empty() {
            return None;
        }
        let version = event.get("version").and_then(Value::as_u64).unwrap_or_default();
        let reason = event
            .get("reason")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string);
        let participants = event
            .get("participants")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let items = event
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        return Some(summarize_swarm_plan_items(
            &swarm_id,
            version,
            participants,
            reason,
            items,
            None,
        ));
    }
    None
}

fn load_session_sidebar_summary(path: &Path) -> Result<Option<serde_json::Value>, String> {
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))?;

    let id = string_field(&value, "id")
        .or_else(|| {
            path.file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "unknown-session".to_string());
    let short_name = string_field(&value, "short_name").unwrap_or_else(|| short_session_name(&id));
    let message_count = value
        .get("messages")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let title = string_field(&value, "custom_title")
        .or_else(|| string_field(&value, "title"))
        .or_else(|| latest_user_preview(&value))
        .unwrap_or_else(|| short_name.clone());
    let status = string_field(&value, "status").unwrap_or_else(|| "unknown".to_string());
    let model = string_field(&value, "model").unwrap_or_else(|| "model unknown".to_string());
    let provider = string_field(&value, "provider_key");
    let working_dir = string_field(&value, "working_dir");
    let updated = string_field(&value, "last_active_at")
        .or_else(|| string_field(&value, "updated_at"))
        .map(|timestamp| compact_timestamp(&timestamp));
    let cwd = working_dir
        .as_deref()
        .and_then(compact_path)
        .unwrap_or_else(|| "no workspace".to_string());
    let swarm_status = latest_swarm_status_summary(&value, &id);
    let swarm_plan = latest_swarm_plan_summary(&value);
    let effective_status = swarm_status
        .as_ref()
        .map(|(status, _, _, _)| status.clone())
        .unwrap_or_else(|| status.clone());
    let subtitle = format!("{effective_status} · {model}");
    let detail = match updated {
        Some(updated) => format!("{message_count} msgs · {updated} · {cwd}"),
        None => format!("{message_count} msgs · {cwd}"),
    };
    let preview_lines = recent_message_preview_lines(
        &value,
        SESSION_PREVIEW_LINE_LIMIT,
        SESSION_PREVIEW_CHAR_LIMIT,
    );
    let detail_lines = recent_message_preview_lines(
        &value,
        SESSION_DETAIL_LINE_LIMIT,
        SESSION_DETAIL_CHAR_LIMIT,
    );

    let mut summary = serde_json::json!({
        "id": id,
        "title": title,
        "subtitle": subtitle,
        "detail": detail,
        "preview_lines": preview_lines,
        "detail_lines": detail_lines,
        "model": string_field(&value, "model"),
        "provider": provider,
        "status": effective_status,
        "working_dir": working_dir,
    });

    if let Some(swarm_plan) = swarm_plan.clone() {
        if let Some(swarm_id) = swarm_plan.get("swarm_id").and_then(Value::as_str) {
            summary["swarm_id"] = serde_json::json!(swarm_id);
        }
        if let Some(participant_count) = swarm_plan.get("participant_count").and_then(Value::as_u64) {
            if participant_count >= 2 {
                summary["swarm_enabled"] = serde_json::json!(true);
                summary["swarm_peer_count"] = serde_json::json!(participant_count);
            }
        }
        summary["swarm_plan"] = swarm_plan;
    }

    if let Some((_, detail, role, peer_count)) = swarm_status {
        summary["swarm_enabled"] = serde_json::json!(peer_count >= 2);
        summary["swarm_peer_count"] = serde_json::json!(peer_count);
        if let Some(role) = role {
            summary["swarm_role"] = serde_json::json!(role);
        }
        if let Some(detail) = detail {
            let current_detail = summary
                .get("detail")
                .and_then(Value::as_str)
                .unwrap_or_default();
            summary["detail"] = serde_json::json!(if current_detail.is_empty() {
                detail
            } else {
                format!("{current_detail} · {detail}")
            });
        }
    }

    Ok(Some(summary))
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn latest_user_preview(value: &Value) -> Option<String> {
    value
        .get("messages")
        .and_then(Value::as_array)?
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(message_text_preview)
}

fn message_text_preview(message: &Value) -> Option<String> {
    let mut text = String::new();
    for block in message.get("content")?.as_array()? {
        let Some(block_text) = block.get("text").and_then(Value::as_str) else {
            continue;
        };
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(block_text.trim());
    }

    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        None
    } else {
        Some(truncate_chars(&normalized, 64))
    }
}

fn recent_message_preview_lines(value: &Value, limit: usize, char_limit: usize) -> Vec<String> {
    let Some(messages) = value.get("messages").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut previews = messages
        .iter()
        .rev()
        .filter_map(|message| message_preview_line(message, char_limit))
        .take(limit)
        .collect::<Vec<_>>();
    previews.reverse();
    previews
}

fn message_preview_line(message: &Value, char_limit: usize) -> Option<String> {
    let role = match message.get("role").and_then(Value::as_str)? {
        "user" => "user",
        "assistant" => "asst",
        "system" => "sys",
        _ => return None,
    };
    let text = message_preview_text(message, char_limit)?;
    Some(format!("{role} {text}"))
}

fn message_preview_text(message: &Value, char_limit: usize) -> Option<String> {
    let mut fragments = Vec::new();
    for block in message.get("content")?.as_array()? {
        match block.get("type").and_then(Value::as_str) {
            Some("text") | None => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    let normalized = normalize_preview_text(text);
                    if !normalized.is_empty() {
                        fragments.push(normalized);
                    }
                }
            }
            Some("tool_use") => {
                if let Some(name) = block.get("name").and_then(Value::as_str) {
                    fragments.push(format!("tool {name}"));
                }
            }
            Some("tool_result") => {}
            _ => {}
        }
    }

    let joined = fragments.join(" ");
    if joined.is_empty() {
        None
    } else {
        Some(truncate_chars(&joined, char_limit))
    }
}

fn normalize_preview_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn short_session_name(id: &str) -> String {
    id.strip_prefix("session_")
        .and_then(|rest| rest.split('_').next())
        .filter(|name| !name.is_empty())
        .unwrap_or(id)
        .to_string()
}

fn compact_timestamp(timestamp: &str) -> String {
    timestamp
        .split_once('T')
        .map(|(date, time)| format!("{} {}", date, time.chars().take(5).collect::<String>()))
        .unwrap_or_else(|| truncate_chars(timestamp, 18))
}

fn compact_path(path: &str) -> Option<String> {
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    let basename = Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string());
    Some(truncate_chars(&basename, 28))
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn live_phase_label(
    is_processing: bool,
    current_tool_name: Option<&str>,
    connection_phase: Option<&str>,
    status_detail: Option<&str>,
) -> &'static str {
    let detail = status_detail.unwrap_or_default().to_ascii_lowercase();
    let phase = connection_phase.unwrap_or_default().to_ascii_lowercase();
    if detail.contains("compact") || detail.contains("chunk") || detail.contains("summar") {
        return "chunking";
    }
    if current_tool_name.is_some() {
        return "tool";
    }
    if is_processing {
        return "thinking";
    }
    if phase.contains("wait") || detail.contains("wait") || detail.contains("queued") {
        return "waiting";
    }
    "idle"
}

async fn active_runtime(state: &State<'_, AppState>) -> Result<Arc<SessionRuntime>, String> {
    let active_session_id = state
        .active_session_id
        .lock()
        .await
        .clone()
        .ok_or("No active session")?;
    let runtime = state
        .runtimes
        .lock()
        .await
        .get(&active_session_id)
        .cloned()
        .ok_or("Active session runtime not found")?;
    Ok(runtime)
}

async fn emit_runtime_snapshot(app_handle: &AppHandle, runtime: &Arc<SessionRuntime>) -> Result<(), String> {
    let session_id = runtime.session_id.clone();
    let snapshot = if let Ok(agent) = runtime.agent.try_lock() {
        let provider = agent.provider_handle();
        let (messages, images) = agent.get_history_and_rendered_images();
        let available_models = provider.available_models_for_switching();
        let available_model_routes: Vec<serde_json::Value> = agent
            .model_routes()
            .into_iter()
            .filter(|r| jcode::provider::is_listable_model_name(&r.model))
            .map(serialize_model_route)
            .collect();
        (
            serde_json::to_value(messages).unwrap_or(serde_json::json!([])),
            serde_json::to_value(images).unwrap_or(serde_json::json!([])),
            Some(provider.name().to_string()),
            Some(provider.model()),
            serde_json::to_value(available_models).unwrap_or(serde_json::json!([])),
            serde_json::to_value(available_model_routes).unwrap_or(serde_json::json!([])),
            agent.provider_handle().reasoning_effort(),
            agent.last_connection_type(),
            agent.last_status_detail(),
            agent.memory_enabled(),
        )
    } else {
        let session = Session::load(&session_id)
            .or_else(|_| Session::load_startup_stub(&session_id))
            .map_err(|e| format!("Failed to snapshot busy session {}: {e}", &session_id))?;
        (
            serde_json::to_value(desktop_history_messages(&session)).unwrap_or(serde_json::json!([])),
            serde_json::json!([]),
            session.provider_key.clone(),
            session.model.clone(),
            serde_json::json!([]),
            serde_json::json!([]),
            session.reasoning_effort.clone(),
            None,
            runtime.status_detail.lock().await.clone(),
            true,
        )
    };
    let (
        messages,
        images,
        provider_name,
        provider_model,
        available_models,
        available_model_routes,
        reasoning_effort,
        connection_type,
        status_detail,
        memory_enabled,
    ) = snapshot;

    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "session", "session_id": session_id.clone() }),
        )
        .ok();
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({
                "type": "history",
                "id": 0,
                "session_id": session_id.clone(),
                "messages": messages,
                "images": images,
                "provider_name": provider_name,
                "provider_model": provider_model,
                "available_models": available_models,
                "available_model_routes": available_model_routes,
                "all_sessions": Vec::<String>::new(),
                "reasoning_effort": reasoning_effort,
                "connection_type": connection_type,
                "status_detail": status_detail,
                "memory_enabled": memory_enabled,
            }),
        )
        .ok();
    Ok(())
}

async fn register_runtime_and_emit(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    mut agent: jcode::agent::Agent,
) -> Result<Arc<SessionRuntime>, String> {
    let session_id = agent.session_id().to_string();
    let cancel_signal = agent.graceful_shutdown_signal();
    let (_stdin_tx, mut stdin_rx) = setup_stdin_channel(&mut agent);
    let runtime = Arc::new(SessionRuntime::new(session_id.clone(), agent, cancel_signal));

    {
        let mut runtimes = state.runtimes.lock().await;
        runtimes.insert(session_id.clone(), runtime.clone());
    }
    {
        let mut active = state.active_session_id.lock().await;
        *active = Some(session_id);
    }

    let handle = app_handle.clone();
    let pending = state.pending_stdin.clone();
    let active_session_id = state.active_session_id.clone();
    let runtime_for_stdin = runtime.clone();
    tokio::spawn(async move {
        while let Some(req) = stdin_rx.recv().await {
            let rid = req.request_id.clone();
            pending.lock().await.insert(rid.clone(), req.response_tx);
            let is_active = active_session_id.lock().await.as_deref() == Some(&runtime_for_stdin.session_id);
            if is_active {
                handle
                    .emit(
                        "server-event",
                        &serde_json::json!({
                            "type": "stdin_request",
                            "request_id": rid,
                            "prompt": req.prompt,
                            "is_password": req.is_password,
                            "tool_call_id": "",
                        }),
                    )
                    .ok();
            }
        }
    });

    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "connection_phase", "phase": "connected" }),
        )
        .ok();
    emit_runtime_snapshot(app_handle, &runtime).await?;
    Ok(runtime)
}

#[tauri::command]
async fn begin_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: Option<String>,
    model: Option<String>,
    memory_enabled: Option<bool>,
) -> Result<(), String> {
    let provider = create_provider().await?;
    if let Some(ref model_name) = model {
        jcode::provider::set_model_with_auth_refresh(provider.as_ref(), model_name)
            .map_err(|e| format!("Failed to set model: {e}"))?;
    }

    let mut session = Session::create(None, None);
    session.working_dir = working_dir.clone();
    session.model = Some(provider.model());
    session.provider_key = jcode::session::derive_session_provider_key(provider.name());

    let mut agent = create_agent_with_session(provider, session, working_dir.as_deref()).await?;
    let resolved_memory_enabled = memory_enabled.unwrap_or_else(|| {
        jcode::config::Config::resolve_workspace_memory_enabled(working_dir.as_deref())
    });
    agent.set_memory_enabled(resolved_memory_enabled);

    register_runtime_and_emit(&app_handle, &state, agent).await.map(|_| ())
}

#[tauri::command]
async fn resume_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    working_dir: Option<String>,
) -> Result<(), String> {
    if let Some(runtime) = state.runtimes.lock().await.get(&session_id).cloned() {
        {
            let mut active = state.active_session_id.lock().await;
            *active = Some(session_id);
        }
        app_handle
            .emit(
                "server-event",
                &serde_json::json!({ "type": "connection_phase", "phase": "connected" }),
            )
            .ok();
        emit_runtime_snapshot(&app_handle, &runtime).await?;
        return Ok(());
    }

    let session = Session::load(&session_id)
        .map_err(|e| format!("Failed to load session {}: {e}", &session_id))?;
    let provider = create_provider().await?;
    if let Some(ref saved_model) = session.model {
        let _ = jcode::provider::set_model_with_auth_refresh(provider.as_ref(), saved_model);
    }

    let agent = create_agent_with_session(provider, session, working_dir.as_deref()).await?;
    register_runtime_and_emit(&app_handle, &state, agent).await.map(|_| ())
}

#[tauri::command]
async fn send_message(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    content: String,
    images: Option<Vec<(String, String)>>,
    system_reminder: Option<String>,
) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    {
        let mut processing = runtime.is_processing.lock().await;
        *processing = true;
    }
    {
        let mut tool = runtime.current_tool_name.lock().await;
        *tool = None;
    }

    let handle = app_handle.clone();
    let active_session_id = state.active_session_id.clone();
    let live_swarm_members = state.live_swarm_members.clone();
    let live_swarm_plans = state.live_swarm_plans.clone();
    let live_swarm_proposals = state.live_swarm_proposals.clone();
    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ServerEvent>();
        let runtime_for_reader = runtime.clone();
        let rh = handle.clone();
        let active_for_reader = active_session_id.clone();
        let live_swarm_members_for_reader = live_swarm_members.clone();
        let live_swarm_plans_for_reader = live_swarm_plans.clone();
        let live_swarm_proposals_for_reader = live_swarm_proposals.clone();
        let reader = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match &event {
                    ServerEvent::ToolStart { name, .. } => {
                        *runtime_for_reader.current_tool_name.lock().await = Some(name.clone());
                        *runtime_for_reader.is_processing.lock().await = true;
                    }
                    ServerEvent::ToolDone { .. } => {
                        *runtime_for_reader.current_tool_name.lock().await = None;
                    }
                    ServerEvent::StatusDetail { detail } => {
                        *runtime_for_reader.status_detail.lock().await = Some(detail.clone());
                    }
                    ServerEvent::ConnectionPhase { phase } => {
                        *runtime_for_reader.connection_phase.lock().await = Some(phase.clone());
                    }
                    ServerEvent::Done { .. } | ServerEvent::Interrupted => {
                        *runtime_for_reader.is_processing.lock().await = false;
                        *runtime_for_reader.current_tool_name.lock().await = None;
                    }
                    ServerEvent::Error { .. } => {
                        *runtime_for_reader.is_processing.lock().await = false;
                        *runtime_for_reader.current_tool_name.lock().await = None;
                    }
                    ServerEvent::SwarmStatus { members } => {
                        let peer_count = members.len();
                        let mut guard = live_swarm_members_for_reader.lock().await;
                        for member in members {
                            if member.session_id == runtime_for_reader.session_id {
                                *runtime_for_reader.status_detail.lock().await = member.detail.clone();
                            }
                            guard.insert(
                                member.session_id.clone(),
                                serde_json::json!({
                                    "status": member.status,
                                    "detail": member.detail,
                                    "role": member.role,
                                    "peer_count": peer_count,
                                }),
                            );
                        }
                    }
                    ServerEvent::SwarmPlan {
                        swarm_id,
                        version,
                        items,
                        participants,
                        reason,
                        summary,
                    } => {
                        let item_values = items
                            .iter()
                            .map(|item| {
                                serde_json::json!({
                                    "id": item.id,
                                    "content": item.content,
                                    "status": item.status,
                                    "priority": item.priority,
                                    "subsystem": item.subsystem,
                                    "file_scope": item.file_scope,
                                    "blocked_by": item.blocked_by,
                                    "assigned_to": item.assigned_to,
                                })
                            })
                            .collect::<Vec<_>>();
                        let plan_summary = summarize_swarm_plan_items(
                            swarm_id,
                            *version,
                            participants.clone(),
                            reason.clone(),
                            item_values,
                            summary.as_ref(),
                        );
                        let participant_ids = if participants.is_empty() {
                            vec![runtime_for_reader.session_id.clone()]
                        } else {
                            participants.clone()
                        };
                        let mut guard = live_swarm_plans_for_reader.lock().await;
                        for participant_id in &participant_ids {
                            guard.insert(participant_id.clone(), plan_summary.clone());
                        }
                        let mut proposal_guard = live_swarm_proposals_for_reader.lock().await;
                        for participant_id in participant_ids {
                            proposal_guard.remove(&participant_id);
                        }
                    }
                    ServerEvent::SwarmPlanProposal {
                        swarm_id,
                        proposer_session,
                        proposer_name,
                        items,
                        summary,
                        proposal_key,
                    } => {
                        let proposal_summary = summarize_swarm_proposal(
                            swarm_id,
                            proposer_session,
                            proposer_name.clone(),
                            summary.clone(),
                            proposal_key.clone(),
                            items
                                .iter()
                                .map(|item| {
                                    serde_json::json!({
                                        "id": item.id,
                                        "content": item.content,
                                        "status": item.status,
                                        "priority": item.priority,
                                        "subsystem": item.subsystem,
                                        "file_scope": item.file_scope,
                                        "blocked_by": item.blocked_by,
                                        "assigned_to": item.assigned_to,
                                    })
                                })
                                .collect::<Vec<_>>(),
                        );
                        live_swarm_proposals_for_reader
                            .lock()
                            .await
                            .insert(runtime_for_reader.session_id.clone(), proposal_summary);
                    }
                    _ => {}
                }

                let is_active = active_for_reader.lock().await.as_deref() == Some(&runtime_for_reader.session_id);
                if is_active {
                    let payload = serde_json::to_value(&event).unwrap_or_default();
                    rh.emit("server-event", &payload).ok();
                }
            }
        });

        let result = runtime
            .agent
            .lock()
            .await
            .run_once_streaming_mpsc(&content, images.unwrap_or_default(), system_reminder, tx)
            .await;
        reader.await.ok();
        runtime.cancel_signal.reset();
        *runtime.is_processing.lock().await = false;
        *runtime.current_tool_name.lock().await = None;

        let is_active = active_session_id.lock().await.as_deref() == Some(&runtime.session_id);
        if let Err(e) = result {
            if is_active {
                handle
                    .emit(
                        "server-event",
                        &serde_json::json!({ "type": "error", "id": 0, "message": format!("{e:#}") }),
                    )
                    .ok();
            }
        }
        if is_active {
            handle
                .emit(
                    "server-event",
                    &serde_json::json!({ "type": "done", "id": 0 }),
                )
                .ok();
        }
    });
    Ok(())
}

#[tauri::command]
async fn cancel(state: State<'_, AppState>) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    runtime.cancel_signal.fire();
    Ok(())
}

#[tauri::command]
async fn set_model(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    model: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    let mut guard = runtime.agent.lock().await;
    let model_arg = if let Some(pid) = profile_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        format!("{}:{}", pid, model)
    } else {
        model
    };
    guard
        .set_model(&model_arg)
        .map_err(|e| format!("Failed to set model: {e}"))?;
    let current = guard.provider_handle().model();
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "model_changed", "id": 0, "model": current }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn set_memory_enabled(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    let mut guard = runtime.agent.lock().await;
    guard.set_memory_enabled(enabled);
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "memory_feature_changed", "enabled": enabled }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn get_workspace_memory_preferences() -> Result<serde_json::Value, String> {
    let cfg = jcode::config::Config::load();
    Ok(serde_json::json!({
        "default_enabled": cfg.workspace_memory.default_enabled.unwrap_or(cfg.features.memory),
        "workspaces": cfg.workspace_memory.workspaces,
    }))
}

#[tauri::command]
async fn set_workspace_memory_preference(
    working_dir: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    jcode::config::Config::set_workspace_memory_enabled(working_dir.as_deref(), enabled)
        .map_err(|e| format!("Failed to save workspace memory preference: {e}"))
}

fn delete_session_artifacts(session_id: &str) -> Result<(), String> {
    let session_path = jcode::session::session_path(session_id)
        .map_err(|e| format!("Failed to resolve session path for {session_id}: {e}"))?;
    if session_path.exists() {
        fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to remove {}: {e}", session_path.display()))?;
    }

    let journal_path = jcode::session::session_journal_path(session_id)
        .map_err(|e| format!("Failed to resolve journal path for {session_id}: {e}"))?;
    if journal_path.exists() {
        fs::remove_file(&journal_path)
            .map_err(|e| format!("Failed to remove {}: {e}", journal_path.display()))?;
    }

    Ok(())
}

#[tauri::command]
async fn delete_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let active_session_id = state.active_session_id.lock().await.clone();
    if active_session_id.as_deref() == Some(session_id.as_str()) {
        return Err("Cannot delete the active session. Switch to another session first.".to_string());
    }

    if let Some(runtime) = state.runtimes.lock().await.get(&session_id).cloned() {
        if *runtime.is_processing.lock().await {
            return Err("Cannot delete a running session.".to_string());
        }
    }

    state.runtimes.lock().await.remove(&session_id);
    state.live_swarm_members.lock().await.remove(&session_id);
    state.live_swarm_plans.lock().await.remove(&session_id);
    state.live_swarm_proposals.lock().await.retain(|_, proposal| {
        proposal
            .get("proposer_session")
            .and_then(Value::as_str)
            != Some(session_id.as_str())
    });

    delete_session_artifacts(&session_id)
}

#[tauri::command]
async fn delete_workspace_sessions(
    state: State<'_, AppState>,
    working_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let workspace_key = working_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("default")
        .to_string();
    let active_session_id = state.active_session_id.lock().await.clone();
    let live_runtimes = state.runtimes.lock().await.clone();

    let mut blocked_sessions = Vec::new();
    let mut runtime_sessions_to_remove = Vec::new();
    for (session_id, runtime) in &live_runtimes {
        let runtime_working_dir = runtime
            .agent
            .try_lock()
            .ok()
            .and_then(|agent| agent.working_dir().map(str::to_string))
            .unwrap_or_else(|| "default".to_string());
        if runtime_working_dir != workspace_key {
            continue;
        }
        let is_processing = *runtime.is_processing.lock().await;
        let is_active = active_session_id.as_deref() == Some(session_id.as_str());
        if is_processing || is_active {
            blocked_sessions.push(session_id.clone());
        } else {
            runtime_sessions_to_remove.push(session_id.clone());
        }
    }

    if !blocked_sessions.is_empty() {
        return Err(format!(
            "Cannot delete workspace while active/running sessions exist: {}",
            blocked_sessions.join(", ")
        ));
    }

    let dir = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("sessions");
    if !dir.exists() {
        return Ok(serde_json::json!({ "deleted_count": 0, "deleted_ids": Vec::<String>::new() }));
    }

    let candidates = fs::read_dir(&dir)
        .map_err(|e| format!("failed to read {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| session_file_candidate(entry.path()))
        .collect::<Vec<_>>();

    let mut deleted_ids = Vec::new();
    for candidate in candidates {
        let Ok(Some(summary)) = load_session_sidebar_summary(&candidate.path) else {
            continue;
        };
        let Some(session_id) = summary.get("id").and_then(Value::as_str) else {
            continue;
        };
        let summary_workspace = summary
            .get("working_dir")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("default");
        if summary_workspace != workspace_key {
            continue;
        }
        delete_session_artifacts(session_id)?;
        deleted_ids.push(session_id.to_string());
    }

    {
        let mut runtimes = state.runtimes.lock().await;
        for session_id in &runtime_sessions_to_remove {
            runtimes.remove(session_id);
        }
    }
    {
        let mut members = state.live_swarm_members.lock().await;
        for session_id in &deleted_ids {
            members.remove(session_id);
        }
    }
    {
        let mut plans = state.live_swarm_plans.lock().await;
        for session_id in &deleted_ids {
            plans.remove(session_id);
        }
    }
    state.live_swarm_proposals.lock().await.retain(|_, proposal| {
        let proposer = proposal.get("proposer_session").and_then(Value::as_str);
        !deleted_ids.iter().any(|session_id| Some(session_id.as_str()) == proposer)
    });

    Ok(serde_json::json!({
        "deleted_count": deleted_ids.len(),
        "deleted_ids": deleted_ids,
    }))
}

#[tauri::command]
async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let dir = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("sessions");
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut candidates = fs::read_dir(&dir)
        .map_err(|e| format!("failed to read {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| session_file_candidate(entry.path()))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.modified));

    let live_runtimes = state.runtimes.lock().await.clone();
    let live_swarm_members = state.live_swarm_members.lock().await.clone();
    let live_swarm_plans = state.live_swarm_plans.lock().await.clone();
    let live_swarm_proposals = state.live_swarm_proposals.lock().await.clone();
    let mut live_workspace_counts: HashMap<String, usize> = HashMap::new();
    let mut workspace_coordinators: HashMap<String, String> = HashMap::new();
    let mut workspace_ordinals: HashMap<String, u64> = HashMap::new();
    for runtime in live_runtimes.values() {
        let working_dir = runtime
            .agent
            .try_lock()
            .ok()
            .and_then(|agent| agent.working_dir().map(str::to_string))
            .unwrap_or_else(|| "default".to_string());
        *live_workspace_counts.entry(working_dir.clone()).or_insert(0) += 1;
        let current_best = workspace_ordinals.get(&working_dir).copied();
        if current_best.is_none() || runtime.ordinal < current_best.unwrap_or(u64::MAX) {
            workspace_ordinals.insert(working_dir.clone(), runtime.ordinal);
            workspace_coordinators.insert(working_dir, runtime.session_id.clone());
        }
    }

    let mut sessions = Vec::new();
    for candidate in candidates {
        match load_session_sidebar_summary(&candidate.path) {
            Ok(Some(mut summary)) => {
                if let Some(session_id) = summary
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                {
                    let working_dir_key = summary
                        .get("working_dir")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or("default")
                        .to_string();
                    if let Some(member) = live_swarm_members.get(&session_id) {
                        if let Some(status) = member.get("status").and_then(Value::as_str) {
                            summary["status"] = serde_json::json!(status);
                            if let Some(model) = summary.get("model").and_then(Value::as_str) {
                                summary["subtitle"] = serde_json::json!(format!("{status} · {model}"));
                            }
                        }
                        if let Some(detail) = member.get("detail").and_then(Value::as_str).filter(|value| !value.trim().is_empty()) {
                            let current_detail = summary
                                .get("detail")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            summary["detail"] = serde_json::json!(if current_detail.contains(detail) {
                                current_detail.to_string()
                            } else if current_detail.is_empty() {
                                detail.to_string()
                            } else {
                                format!("{current_detail} · {detail}")
                            });
                        }
                        if let Some(role) = member.get("role").and_then(Value::as_str) {
                            summary["swarm_role"] = serde_json::json!(role);
                        }
                        if let Some(peer_count) = member.get("peer_count").and_then(Value::as_u64) {
                            if peer_count >= 2 {
                                summary["swarm_enabled"] = serde_json::json!(true);
                                summary["swarm_peer_count"] = serde_json::json!(peer_count);
                            }
                        }
                    }
                    if let Some(plan) = live_swarm_plans.get(&session_id) {
                        if let Some(swarm_id) = plan.get("swarm_id").and_then(Value::as_str) {
                            summary["swarm_id"] = serde_json::json!(swarm_id);
                        }
                        if let Some(participant_count) = plan.get("participant_count").and_then(Value::as_u64) {
                            if participant_count >= 2 {
                                summary["swarm_enabled"] = serde_json::json!(true);
                                summary["swarm_peer_count"] = serde_json::json!(participant_count);
                            }
                        }
                        summary["swarm_plan"] = plan.clone();
                    }
                    if let Some(proposal) = live_swarm_proposals.get(&session_id) {
                        if let Some(swarm_id) = proposal.get("swarm_id").and_then(Value::as_str) {
                            summary["swarm_id"] = serde_json::json!(swarm_id);
                        }
                        summary["swarm_proposal"] = proposal.clone();
                    }
                    let swarm_peer_count = *live_workspace_counts.get(&working_dir_key).unwrap_or(&0);
                    if swarm_peer_count >= 2 {
                        summary["swarm_enabled"] = serde_json::json!(true);
                        summary["swarm_peer_count"] = serde_json::json!(swarm_peer_count);
                        summary["swarm_role"] = serde_json::json!(if workspace_coordinators.get(&working_dir_key) == Some(&session_id) {
                            "coordinator"
                        } else {
                            "agent"
                        });
                    }
                    if let Some(runtime) = live_runtimes.get(&session_id) {
                        let is_processing = *runtime.is_processing.lock().await;
                        let current_tool_name = runtime.current_tool_name.lock().await.clone();
                        let status_detail = runtime.status_detail.lock().await.clone();
                        let connection_phase = runtime.connection_phase.lock().await.clone();
                        let live_phase = live_phase_label(
                            is_processing,
                            current_tool_name.as_deref(),
                            connection_phase.as_deref(),
                            status_detail.as_deref(),
                        );
                        summary["live_processing"] = serde_json::json!(is_processing);
                        summary["live_phase"] = serde_json::json!(live_phase);
                        if let Some(tool_name) = current_tool_name.clone() {
                            summary["live_tool_name"] = serde_json::json!(tool_name);
                        }
                        if let Some(detail) = status_detail.clone().filter(|value| !value.trim().is_empty()) {
                            summary["live_status_detail"] = serde_json::json!(detail.clone());
                        }
                        if is_processing {
                            summary["status"] = serde_json::json!(match live_phase {
                                "chunking" => "chunking",
                                _ => "running",
                            });
                            summary["subtitle"] = serde_json::json!(match live_phase {
                                "chunking" => "running · chunking".to_string(),
                                "tool" => match current_tool_name.as_deref() {
                                    Some(tool) => format!("running · {tool}"),
                                    None => "running · tool".to_string(),
                                },
                                "thinking" => "running · thinking".to_string(),
                                _ => "running".to_string(),
                            });
                        } else if swarm_peer_count >= 2 {
                            summary["subtitle"] = serde_json::json!(match live_phase {
                                "waiting" => "swarm · waiting".to_string(),
                                _ => summary.get("subtitle").and_then(Value::as_str).unwrap_or("ready").to_string(),
                            });
                        }
                        if let Some(detail) = status_detail.filter(|value| !value.trim().is_empty()) {
                            let current_detail = summary
                                .get("detail")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            summary["detail"] = serde_json::json!(if current_detail.is_empty() {
                                detail
                            } else {
                                format!("{current_detail} · {detail}")
                            });
                        }
                    }
                }
                sessions.push(summary)
            }
            Ok(None) => {}
            Err(error) => eprintln!(
                "desktop-app: skipped session {}: {error}",
                candidate.path.display()
            ),
        }
    }

    Ok(sessions)
}

#[tauri::command]
async fn send_stdin_response(
    state: State<'_, AppState>,
    request_id: String,
    input: String,
) -> Result<(), String> {
    let mut guard = state.pending_stdin.lock().await;
    if let Some(tx) = guard.remove(&request_id) {
        let _ = tx.send(input);
        Ok(())
    } else {
        Err(format!("No pending stdin request with id {}", request_id))
    }
}

#[tauri::command]
async fn get_models(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let runtime = active_runtime(&state).await?;
    let provider = { runtime.agent.lock().await.provider_handle() };
    let _ = provider.prefetch_models().await;
    let guard = runtime.agent.lock().await;
    let raw_routes = guard
        .model_routes()
        .into_iter()
        .filter(|r| jcode::provider::is_listable_model_name(&r.model))
        .collect::<Vec<_>>();
    let routes: Vec<serde_json::Value> = raw_routes.iter().cloned().map(serialize_model_route).collect();
    let current_provider_name = guard.provider_handle().name().to_string();
    let providers = provider_entries_from_routes(&raw_routes, Some(&current_provider_name));
    Ok(serde_json::json!({
        "routes": routes,
        "providers": providers,
        "current": guard.provider_handle().model(),
    }))
}

#[tauri::command]
async fn save_provider_api_key(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    api_key: String,
    region: Option<String>,
    api_base: Option<String>,
) -> Result<(), String> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    match provider_id.as_str() {
        "openrouter" => {
            jcode::cli::provider_init::save_named_api_key(
                "openrouter.env",
                "OPENROUTER_API_KEY",
                trimmed_key,
            )
            .map_err(|e| format!("Failed to save OpenRouter API key: {e}"))?;
        }
        "openai-api" => {
            jcode::cli::provider_init::save_named_api_key("openai.env", "OPENAI_API_KEY", trimmed_key)
                .map_err(|e| format!("Failed to save OpenAI API key: {e}"))?;
        }
        "cursor" => {
            jcode::cli::provider_init::save_named_api_key("cursor.env", "CURSOR_API_KEY", trimmed_key)
                .map_err(|e| format!("Failed to save Cursor API key: {e}"))?;
        }
        "jcode" => {
            jcode::cli::provider_init::save_named_api_key(
                jcode::subscription_catalog::JCODE_ENV_FILE,
                jcode::subscription_catalog::JCODE_API_KEY_ENV,
                trimmed_key,
            )
            .map_err(|e| format!("Failed to save Jcode API key: {e}"))?;

            if let Some(api_base) = api_base.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                jcode::provider_catalog::save_env_value_to_env_file(
                    jcode::subscription_catalog::JCODE_API_BASE_ENV,
                    jcode::subscription_catalog::JCODE_ENV_FILE,
                    Some(api_base),
                )
                .map_err(|e| format!("Failed to save Jcode API base: {e}"))?;
                jcode::env::set_var(jcode::subscription_catalog::JCODE_API_BASE_ENV, api_base);
            }
        }
        "bedrock" => {
            let region = region
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("us-east-2");
            jcode::cli::provider_init::save_named_api_key(
                jcode::provider::bedrock::ENV_FILE,
                jcode::provider::bedrock::API_KEY_ENV,
                trimmed_key,
            )
            .map_err(|e| format!("Failed to save Bedrock API key: {e}"))?;
            jcode::provider_catalog::save_env_value_to_env_file(
                jcode::provider::bedrock::REGION_ENV,
                jcode::provider::bedrock::ENV_FILE,
                Some(region),
            )
            .map_err(|e| format!("Failed to save Bedrock region: {e}"))?;
            jcode::env::set_var(jcode::provider::bedrock::REGION_ENV, region);
        }
        _ => return Err(format!("Inline API key save is not supported for provider `{provider_id}`")),
    }

    jcode::auth::AuthStatus::invalidate_cache();
    refresh_active_runtime_auth(&app_handle, &state).await?;
    Ok(())
}

#[tauri::command]
async fn start_provider_auth_flow(provider_id: String) -> Result<serde_json::Value, String> {
    let args = vec![
        "login".to_string(),
        "--provider".to_string(),
        provider_id,
        "--print-auth-url".to_string(),
        "--json".to_string(),
    ];
    run_jcode_json_command(&args)
}

#[tauri::command]
async fn complete_provider_auth_flow(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    input_kind: String,
    input: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args = vec![
        "login".to_string(),
        "--provider".to_string(),
        provider_id.clone(),
        "--json".to_string(),
    ];

    match input_kind.as_str() {
        "complete" => args.push("--complete".to_string()),
        "callback_url" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Callback URL is required".to_string())?;
            args.push("--callback-url".to_string());
            args.push(value.to_string());
        }
        "auth_code" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Authorization code is required".to_string())?;
            args.push("--auth-code".to_string());
            args.push(value.to_string());
        }
        "auth_code_or_callback_url" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Callback URL or authorization code is required".to_string())?;
            if value.contains("://") || value.contains("code=") || value.contains("state=") {
                args.push("--callback-url".to_string());
            } else {
                args.push("--auth-code".to_string());
            }
            args.push(value.to_string());
        }
        other => return Err(format!("Unsupported auth completion kind `{other}`")),
    }

    let result = run_jcode_json_command(&args)?;
    jcode::auth::AuthStatus::invalidate_cache();
    refresh_active_runtime_auth(&app_handle, &state).await?;
    Ok(result)
}

#[tauri::command]
async fn clear_chat(app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    let mut guard = runtime.agent.lock().await;
    guard.clear();
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "clear_chat" }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn rewind_chat(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    message_index: usize,
) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    let mut guard = runtime.agent.lock().await;
    guard
        .rewind_to_message(message_index)
        .map_err(|e| format!("Failed to rewind: {e}"))?;
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "rewind_chat", "message_index": message_index }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn set_reasoning_effort(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    effort: String,
) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    let mut guard = runtime.agent.lock().await;
    let current = guard
        .set_reasoning_effort(&effort)
        .map_err(|e| format!("Failed to set reasoning effort: {e}"))?;
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({
                "type": "reasoning_effort_changed",
                "id": 0,
                "effort": current,
            }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn compact_context(app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let runtime = active_runtime(&state).await?;
    let mut guard = runtime.agent.lock().await;
    let provider = guard.provider_fork();
    let compaction = guard.registry().compaction();
    let messages = guard.provider_messages();
    drop(guard);

    if !provider.supports_compaction() {
        app_handle
            .emit(
                "server-event",
                &serde_json::json!({
                    "type": "compact_result",
                    "id": 0,
                    "message": "Manual compaction is not available for this provider.",
                    "success": false,
                }),
            )
            .ok();
        return Ok(());
    }

    let result = match compaction.try_write() {
        Ok(mut manager) => {
            let stats = manager.stats_with(&messages);
            let status_msg = format!(
                "**Context Status:**\n\
                • Messages: {} (active), {} (total history)\n\
                • Token usage: ~{}k (estimate ~{}k) / {}k ({:.1}%)\n\
                • Has summary: {}\n\
                • Compacting: {}",
                stats.active_messages,
                stats.total_turns,
                stats.effective_tokens / 1000,
                stats.token_estimate / 1000,
                manager.token_budget() / 1000,
                stats.context_usage * 100.0,
                if stats.has_summary { "yes" } else { "no" },
                if stats.is_compacting { "in progress..." } else { "no" }
            );

            match manager.force_compact_with(&messages, provider) {
                Ok(()) => serde_json::json!({
                    "type": "compact_result",
                    "id": 0,
                    "message": format!(
                        "{}\n\n📦 **Compacting context** (manual) — summarizing older messages in the background to stay within the context window.\n\
                        The summary will be applied automatically when ready.",
                        status_msg
                    ),
                    "success": true,
                }),
                Err(reason) => serde_json::json!({
                    "type": "compact_result",
                    "id": 0,
                    "message": format!("{}\n\n⚠ **Cannot compact:** {}", status_msg, reason),
                    "success": false,
                }),
            }
        }
        Err(_) => serde_json::json!({
            "type": "compact_result",
            "id": 0,
            "message": "⚠ Cannot access compaction manager (lock held)",
            "success": false,
        }),
    };

    app_handle.emit("server-event", &result).ok();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            begin_session,
            resume_session,
            send_message,
            cancel,
            set_model,
            set_memory_enabled,
            get_workspace_memory_preferences,
            set_workspace_memory_preference,
            list_sessions,
            delete_session,
            delete_workspace_sessions,
            send_stdin_response,
            get_models,
            save_provider_api_key,
            start_provider_auth_flow,
            complete_provider_auth_flow,
            clear_chat,
            rewind_chat,
            set_reasoning_effort,
            compact_context,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
