use crate::commands::{create_agent_with_session, setup_stdin_channel, AppState, SessionRuntime};
use jcode::message::{ContentBlock, Role, ToolCall};
use jcode::provider::Provider;
use jcode::session::{Session, StoredDisplayRole, StoredMessage};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, State};

const DEFAULT_VISIBLE_COMPACTED_HISTORY_MESSAGES: usize = 64;
const SESSION_PREVIEW_LINE_LIMIT: usize = 3;
const SESSION_PREVIEW_CHAR_LIMIT: usize = 72;
const SESSION_DETAIL_LINE_LIMIT: usize = 8;
const SESSION_DETAIL_CHAR_LIMIT: usize = 128;

pub fn is_internal_system_reminder(message: &StoredMessage) -> bool {
    message
        .content
        .iter()
        .find_map(|block| match block {
            ContentBlock::Text { text, .. } => Some(text.trim_start()),
            _ => None,
        })
        .is_some_and(|text| text.starts_with("<system-reminder>"))
}

pub fn message_role(message: &StoredMessage) -> &'static str {
    match message.display_role {
        Some(StoredDisplayRole::System) | Some(StoredDisplayRole::BackgroundTask) => "system",
        None => match message.role {
            Role::User => "user",
            Role::Assistant => "assistant",
        },
    }
}

pub fn fallback_image_label(tool: &ToolCall) -> Option<String> {
    tool.input
        .get("file_path")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub fn push_desktop_message(
    messages: &mut Vec<serde_json::Value>,
    role: &str,
    content: &mut String,
    tool_calls: &mut Vec<String>,
    tool_data: &mut Option<ToolCall>,
    images: &mut Vec<serde_json::Value>,
    timestamp_ms: Option<i64>,
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
        "timestamp_ms": timestamp_ms,
    }));
}

pub fn serialize_model_route(route: jcode::provider::ModelRoute) -> serde_json::Value {
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

pub fn auth_state_label(state: jcode::auth::AuthState) -> &'static str {
    match state {
        jcode::auth::AuthState::Available => "available",
        jcode::auth::AuthState::Expired => "expired",
        jcode::auth::AuthState::NotConfigured => "not_configured",
    }
}

pub fn provider_config_options(provider_key: &str) -> Option<Vec<serde_json::Value>> {
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

pub fn direct_config_provider_id(provider_key: &str) -> Option<String> {
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

pub fn auth_provider_id_for_route(provider_key: &str, api_method: Option<&str>) -> Option<String> {
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

pub fn provider_summary_descriptor(
    provider_key: &str,
) -> Option<jcode::provider_catalog::LoginProviderDescriptor> {
    let auth_provider_id = direct_config_provider_id(provider_key)?;
    jcode::provider_catalog::resolve_login_provider(&auth_provider_id)
}

pub fn auth_owner_descriptor(
    auth_provider_id: Option<&str>,
) -> Option<jcode::provider_catalog::LoginProviderDescriptor> {
    auth_provider_id.and_then(jcode::provider_catalog::resolve_login_provider)
}

pub fn provider_catalog_entry(
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

/// Build provider catalog entries from configured auth profiles rather than
/// model routes. This avoids listing every route-derived provider (e.g.
/// dozens of "via OpenRouter" entries) and shows only the actual provider
/// profiles the user has configured.
pub fn provider_entries_from_profiles(
    routes: &[jcode::provider::ModelRoute],
    current_provider: Option<&str>,
) -> Vec<serde_json::Value> {
    let auth_status = jcode::auth::AuthStatus::check();
    let current_auth_provider_id =
        current_provider.and_then(|provider| auth_provider_id_for_route(provider, None));

    // Pre-compute route counts per auth provider
    let mut route_counts: HashMap<String, usize> = HashMap::new();
    for route in routes {
        if let Some(auth_id) = auth_provider_id_for_route(&route.provider, Some(&route.api_method)) {
            *route_counts.entry(auth_id).or_insert(0) += 1;
        }
    }

    let mut seen = HashSet::new();
    let mut entries = Vec::new();

    // Built-in login providers (Claude, OpenAI, OpenRouter, DeepSeek, etc.)
    for provider in jcode::provider_catalog::auth_status_login_providers() {
        let provider_key = provider.id.to_string();
        seen.insert(provider_key.clone());
        let route_count = route_counts.get(&provider_key).copied().unwrap_or(0);
        let is_current_provider = Some(provider_key.as_str()) == current_auth_provider_id.as_deref();
        let state = auth_status.state_for_provider(provider);
        let method_detail = auth_status.method_detail_for_provider(provider);
        let options = provider_config_options(&provider_key).unwrap_or_default();

        entries.push(serde_json::json!({
            "provider_key": provider_key,
            "auth_provider_id": provider_key,
            "display_name": provider.display_name,
            "has_config_surface": true,
            "configured": matches!(state, jcode::auth::AuthState::Available),
            "status": auth_state_label(state),
            "method_detail": method_detail,
            "route_count": route_count,
            "is_current_provider": is_current_provider,
            "options": options,
        }));
    }

    // Custom provider profiles from config.toml
    let cfg = jcode::config::Config::load();
    for (name, profile) in &cfg.providers {
        if seen.contains(name) {
            continue;
        }
        let provider_key = name.clone();
        let route_count = route_counts.get(&provider_key).copied().unwrap_or(0);
        let is_current_provider = Some(provider_key.as_str()) == current_auth_provider_id.as_deref();

        let configured = if profile.requires_api_key.unwrap_or(true) {
            profile.api_key.is_some()
                || profile
                    .api_key_env
                    .as_ref()
                    .and_then(|key| {
                        jcode::provider_catalog::load_api_key_from_env_or_config(
                            key,
                            profile.env_file.as_deref().unwrap_or(""),
                        )
                    })
                    .is_some()
        } else {
            true
        };

        let status = if configured { "available" } else { "not_configured" };
        let method_detail = if configured {
            format!("Custom profile · {}", profile.base_url)
        } else {
            "API key required".to_string()
        };

        let options = vec![serde_json::json!({
            "provider_id": provider_key,
            "kind": "api_key",
            "label": format!("Save {} API key", provider_key),
            "detail": format!("Configure {} access", provider_key),
        })];

        entries.push(serde_json::json!({
            "provider_key": provider_key,
            "auth_provider_id": provider_key,
            "display_name": provider_key,
            "has_config_surface": true,
            "configured": configured,
            "status": status,
            "method_detail": method_detail,
            "route_count": route_count,
            "is_current_provider": is_current_provider,
            "options": options,
        }));
    }

    // Sort: current first, then configured, then alphabetically
    entries.sort_by(|a, b| {
        let a_current = a
            .get("is_current_provider")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let b_current = b
            .get("is_current_provider")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if a_current != b_current {
            return b_current.cmp(&a_current);
        }
        let a_configured = a
            .get("configured")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let b_configured = b
            .get("configured")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if a_configured != b_configured {
            return b_configured.cmp(&a_configured);
        }
        let a_name = a.get("display_name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("display_name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    entries
}

pub fn provider_entries_from_routes(
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

    // Ensure every login provider with a config surface appears in the catalog
    // even when it has no model routes yet (e.g. unconfigured DeepSeek).
    for provider in jcode::provider_catalog::login_providers() {
        let provider_key = provider.id.to_string();
        if seen.contains(&provider_key) {
            continue;
        }
        if provider_config_options(&provider_key)
            .map(|options| !options.is_empty())
            .unwrap_or(false)
        {
            seen.insert(provider_key.clone());
            ordered.push(provider_key.clone());
            grouped.insert(provider_key, (0usize, None));
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

pub async fn refresh_active_runtime_auth(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    session_id: Option<&str>,
) -> Result<(), String> {
    if let Some(sid) = session_id {
        if let Ok(runtime) = get_runtime_by_session_id(state, sid).await {
            let provider = { runtime.agent.lock().await.provider_handle() };
            provider.on_auth_changed();
            let _ = provider.prefetch_models().await;
            emit_runtime_snapshot(app_handle, &runtime).await?;
        }
    } else {
        let runtimes: Vec<Arc<SessionRuntime>> = {
            state.runtimes.lock().await.values().cloned().collect()
        };
        for runtime in runtimes {
            let provider = { runtime.agent.lock().await.provider_handle() };
            provider.on_auth_changed();
            let _ = provider.prefetch_models().await;
            emit_runtime_snapshot(app_handle, &runtime).await.ok();
        }
    }
    Ok(())
}

pub fn desktop_history_messages(session: &Session) -> Vec<serde_json::Value> {
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

        let timestamp_ms = message.timestamp.map(|timestamp| timestamp.timestamp_millis());
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
                ContentBlock::ToolUse { id, name, input, .. } => {
                    let tool_call = ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                        intent: ToolCall::intent_from_input(input),
                        thought_signature: None,
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
                        timestamp_ms,
                    );
                    pending_role = "assistant";
                    pending_text = content.clone();
                    pending_tool_data = tool_map.get(tool_use_id).cloned().or_else(|| {
                        Some(ToolCall {
                            id: tool_use_id.clone(),
                            name: "tool".to_string(),
                            input: serde_json::Value::Null,
                            intent: None,
                            thought_signature: None,
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
                ContentBlock::Reasoning { .. }
                | ContentBlock::OpenAICompaction { .. }
                | ContentBlock::AnthropicThinking { .. }
                | ContentBlock::OpenAIReasoning { .. }
                | ContentBlock::ReasoningTrace { .. } => {}
            }
        }

        push_desktop_message(
            &mut messages,
            pending_role,
            &mut pending_text,
            &mut pending_tool_calls,
            &mut pending_tool_data,
            &mut pending_images,
            timestamp_ms,
        );
    }

    messages
}

pub fn workspace_history_messages(
    session: &Session,
    session_id: &str,
    role_name: Option<&str>,
) -> Vec<serde_json::Value> {
    desktop_history_messages(session)
        .into_iter()
        .enumerate()
        .map(|(index, message)| {
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("system");
            let tool_executions = message
                .get("tool_data")
                .cloned()
                .map(|tool_data| {
                    vec![serde_json::json!({
                        "id": tool_data.get("id").and_then(Value::as_str).unwrap_or("tool"),
                        "name": tool_data.get("name").and_then(Value::as_str).unwrap_or("tool"),
                        "status": "done",
                        "input": serde_json::to_string(tool_data.get("input").unwrap_or(&Value::Null))
                            .unwrap_or_else(|_| "null".to_string()),
                        "output": "",
                    })]
                })
                .unwrap_or_default();

            serde_json::json!({
                "id": format!("workspace-{session_id}-{index}"),
                "role": role,
                "content": message.get("content").and_then(Value::as_str).unwrap_or_default(),
                "tool_executions": tool_executions,
                "is_streaming": false,
                "images": message.get("images").cloned().unwrap_or_else(|| serde_json::json!([])),
                "timestamp": message.get("timestamp_ms").and_then(Value::as_i64),
                "role_name": (role == "assistant").then_some(role_name).flatten(),
                "role_session_id": (role == "assistant").then_some(session_id),
            })
        })
        .collect()
}

#[derive(Debug)]
pub struct SessionFileCandidate {
    pub path: PathBuf,
    pub modified: SystemTime,
}

pub fn session_file_candidate(path: PathBuf) -> Option<SessionFileCandidate> {
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

pub fn latest_swarm_status_summary(
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

pub fn plan_priority_rank(priority: &str) -> u8 {
    match priority.to_ascii_lowercase().as_str() {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    }
}

pub fn plan_status_rank(status: &str, blocked: bool) -> u8 {
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

pub fn summarize_swarm_plan_items(
    _swarm_id: &str,
    _version: u64,
    _participants: Vec<String>,
    _reason: Option<String>,
    items: Vec<serde_json::Value>,
    summary_override: Option<&jcode::protocol::PlanGraphStatus>,
) -> (usize, usize, usize, usize, Vec<String>, Vec<serde_json::Value>) {
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

    let ready = summary_override.map_or(ready_count, |summary| summary.ready_ids.len());
    let active = summary_override.map_or(active_count, |summary| summary.active_ids.len());
    let blocked = summary_override.map_or(blocked_count, |summary| summary.blocked_ids.len());
    let completed = summary_override.map_or(completed_count, |summary| summary.completed_ids.len());
    let next = summary_override
        .map(|summary| summary.next_ready_ids.iter().take(4).cloned().collect::<Vec<_>>())
        .unwrap_or_else(|| next_ready_ids.into_iter().take(4).collect::<Vec<_>>());

    (ready, active, blocked, completed, next, items_preview)
}

pub fn latest_swarm_plan_summary(value: &Value) -> Option<serde_json::Value> {
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

        let (ready_count, active_count, blocked_count, completed_count, next_ready_ids, items_preview) =
            summarize_swarm_plan_items(
                &swarm_id,
                version,
                participants.clone(),
                reason.clone(),
                items.clone(),
                None,
            );
        return Some(serde_json::json!({
            "swarm_id": swarm_id,
            "version": version,
            "item_count": items.len(),
            "participant_ids": participants,
            "participant_count": participants.len(),
            "reason": reason,
            "ready_count": ready_count,
            "active_count": active_count,
            "blocked_count": blocked_count,
            "completed_count": completed_count,
            "next_ready_ids": next_ready_ids,
            "items_preview": items_preview,
        }));
    }
    None
}

pub fn load_session_sidebar_summary(path: &Path) -> Result<Option<serde_json::Value>, String> {
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
        .unwrap_or_else(|| {
            if message_count == 0 && status.to_lowercase() == "active" {
                "ready".to_string()
            } else {
                status.clone()
            }
        });
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
        "role_name": if swarm_plan.is_some() || swarm_status.is_some() {
            string_field(&value, "custom_title")
        } else {
            None
        },
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

pub fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

pub fn latest_user_preview(value: &Value) -> Option<String> {
    value
        .get("messages")
        .and_then(Value::as_array)?
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(message_text_preview)
}

pub fn message_text_preview(message: &Value) -> Option<String> {
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

pub fn recent_message_preview_lines(value: &Value, limit: usize, char_limit: usize) -> Vec<String> {
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

pub fn message_preview_line(message: &Value, char_limit: usize) -> Option<String> {
    let role = match message.get("role").and_then(Value::as_str)? {
        "user" => "user",
        "assistant" => "asst",
        "system" => "sys",
        _ => return None,
    };
    let text = message_preview_text(message, char_limit)?;
    Some(format!("{role} {text}"))
}

pub fn message_preview_text(message: &Value, char_limit: usize) -> Option<String> {
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

pub fn normalize_preview_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn short_session_name(id: &str) -> String {
    id.strip_prefix("session_")
        .and_then(|rest| rest.split('_').next())
        .filter(|name| !name.is_empty())
        .unwrap_or(id)
        .to_string()
}

pub fn compact_timestamp(timestamp: &str) -> String {
    timestamp
        .split_once('T')
        .map(|(date, time)| format!("{} {}", date, time.chars().take(5).collect::<String>()))
        .unwrap_or_else(|| truncate_chars(timestamp, 18))
}

pub fn compact_path(path: &str) -> Option<String> {
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

pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

pub fn live_phase_label(
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

pub async fn active_runtime(state: &State<'_, AppState>) -> Result<Arc<SessionRuntime>, String> {
    let active_session_id = state
        .active_session_id
        .lock()
        .await
        .clone()
        .ok_or("No active session")?;
    get_runtime_by_session_id(state, &active_session_id).await
}

pub async fn get_runtime_by_session_id(
    state: &State<'_, AppState>,
    session_id: &str,
) -> Result<Arc<SessionRuntime>, String> {
    let runtime = state
        .runtimes
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| format!("Session runtime not found: {session_id}"))?;
    Ok(runtime)
}

/// 静默把 session 从磁盘加载到内存。
/// 与 `register_runtime_and_emit` 的区别：
///   - 不更改 active_session_id
///   - 不发送 connection_phase / history 事件（避免干扰 Swarm 模式的 UI 返回图层）
pub async fn load_session_runtime_silently(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    session_id: &str,
) -> Result<Arc<SessionRuntime>, String> {
    eprintln!("[load_silently] loading session={} from disk", session_id);
    let session = Session::load(session_id)
        .map_err(|e| format!("Session not found and cannot be auto-loaded: {session_id}: {e}"))?;
	let provider = state.get_provider().await?.fork();
	if let Some(ref saved_model) = session.model {
		let model_arg = if let Some(ref pk) = session.provider_key {
			format!("{}:{}", pk, saved_model)
		} else {
			saved_model.clone()
		};
		let _ = jcode::provider::set_model_with_auth_refresh(provider.as_ref(), &model_arg);
	}
    let working_dir = session.working_dir.clone();
    let mut agent =
        create_agent_with_session(provider, session, working_dir.as_deref()).await?;
    let cancel_signal = agent.graceful_shutdown_signal();
    let (_stdin_tx, mut stdin_rx) = setup_stdin_channel(&mut agent);
    let runtime = Arc::new(SessionRuntime::new(
        session_id.to_string(),
        agent,
        cancel_signal,
    ));
    {
        state
            .runtimes
            .lock()
            .await
            .insert(session_id.to_string(), runtime.clone());
    }
    eprintln!("[load_silently] session={} registered in runtimes", session_id);
    // 通知前端该 session 已连接（只更新 sessionData，不改 active session）
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({
                "type": "connection_phase",
                "phase": "connected",
                "session_id": session_id,
            }),
        )
        .ok();
    // stdin 转发（仅当 session 恰好是 active 时才弹出）
    let handle = app_handle.clone();
    let pending = state.pending_stdin.clone();
    let active_session_id = state.active_session_id.clone();
    let rt_for_stdin = runtime.clone();
    tokio::spawn(async move {
        while let Some(req) = stdin_rx.recv().await {
            let rid = req.request_id.clone();
            pending.lock().await.insert(rid.clone(), req.response_tx);
            if active_session_id.lock().await.as_deref() == Some(&rt_for_stdin.session_id) {
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
    Ok(runtime)
}

/// 获取内存中的 runtime，若不存在则从磁盘静默加载。
pub async fn get_or_load_session_runtime(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    session_id: &str,
) -> Result<Arc<SessionRuntime>, String> {
    if let Ok(rt) = get_runtime_by_session_id(state, session_id).await {
        return Ok(rt);
    }
    load_session_runtime_silently(app_handle, state, session_id).await
}

pub async fn emit_runtime_snapshot(app_handle: &AppHandle, runtime: &Arc<SessionRuntime>) -> Result<(), String> {
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
        // When an OpenAI-compatible profile (e.g. DeepSeek) is active, the
        // underlying provider is OpenRouter/OpenAI but we want to show the
        // model family instead of the transport provider.
        let provider_name = infer_provider_name_from_model(provider.name(), &provider.model());
        (
            serde_json::to_value(messages).unwrap_or(serde_json::json!([])),
            serde_json::to_value(images).unwrap_or(serde_json::json!([])),
            Some(provider_name),
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

pub async fn register_runtime_and_emit(
    app_handle: &AppHandle,
    state: &AppState,
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
        *active = Some(session_id.clone());
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
            &serde_json::json!({ "type": "connection_phase", "phase": "connected", "session_id": &session_id }),
        )
        .ok();
    emit_runtime_snapshot(app_handle, &runtime).await?;
    Ok(runtime)
}


#[tauri::command]
/// Infer a display provider name from the model string, matching the logic
/// used in emit_runtime_snapshot so the UI badge updates correctly.
pub fn infer_provider_name_from_model(provider_name: &str, model: &str) -> String {
    let name = provider_name.to_string();
    let m = model.to_lowercase();
    if m.starts_with("deepseek") {
        "DeepSeek".to_string()
    } else if m.starts_with("claude") || m.starts_with("anthropic") {
        "Anthropic".to_string()
    } else if m.starts_with("gemini") || m.starts_with("gemma") {
        "Google".to_string()
    } else if m.starts_with("gpt") || m.starts_with("o1") || m.starts_with("o3") {
        "OpenAI".to_string()
    } else if m.starts_with("llama") || m.starts_with("codellama") {
        "Meta".to_string()
    } else if m.starts_with("qwen") || m.starts_with("qwq") {
        "Alibaba".to_string()
    } else if name.eq_ignore_ascii_case("openrouter") {
        std::env::var("JCODE_OPENROUTER_CACHE_NAMESPACE")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or(name)
    } else {
        name
    }
}