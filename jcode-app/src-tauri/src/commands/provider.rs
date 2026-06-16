use crate::commands::*;
use crate::error::TauriError;
use crate::utils::*;
use jcode::provider::Provider;
use std::collections::HashMap;
use tauri::{AppHandle, State};

use jcode::cli::login::scriptable::{complete_scriptable_login_data, start_scriptable_login_data};
use jcode::cli::login::LoginOptions;
use jcode::provider_catalog::resolve_login_provider;

#[tauri::command]
pub async fn run_auth_test(
    state: State<'_, AppState>,
    provider_id: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    let provider = state.get_provider().await?;

    // If a specific provider_id is given, try to set a model from that provider
    // to ensure we're testing the right provider.
    if let Some(pid) = provider_id.as_deref().filter(|s| !s.is_empty()) {
        let _ = jcode::provider::set_model_with_auth_refresh(provider.as_ref(), pid);
    }

    let prefetch_result = provider.prefetch_models().await;
    let routes = provider.model_routes();
    let available_count = routes.iter().filter(|r| r.available).count();
    let total_count = routes.len();
    let current_model = provider.model();
    let provider_name = provider.name().to_string();

    match prefetch_result {
        Ok(()) => Ok(serde_json::json!({
            "success": true,
            "provider": provider_name,
            "model": current_model,
            "total_routes": total_count,
            "available_routes": available_count,
            "detail": format!("Provider '{}' prefetch succeeded. {}/{} routes available.", provider_name, available_count, total_count),
        })),
        Err(e) => Ok(serde_json::json!({
            "success": false,
            "provider": provider_name,
            "model": current_model,
            "total_routes": total_count,
            "available_routes": available_count,
            "error": format!("{e:#}"),
            "detail": format!("Provider '{}' prefetch failed: {e:#}", provider_name),
        })),
    }
}
#[tauri::command]
pub fn run_auth_doctor() -> Result<serde_json::Value, TauriError> {
    let status = jcode::auth::AuthStatus::check();
    let validation = jcode::auth::validation::load_all();
    let providers = jcode::provider_catalog::auth_status_login_providers();

    let mut provider_reports = Vec::new();
    let mut needs_attention_count = 0usize;

    for provider in providers {
        let assessment = status.assessment_for_provider(provider);
        let validation_result = validation.get(provider.id).map(|r| r.summary.as_str());
        let needs_attn = jcode::auth::doctor::needs_attention(&assessment, validation_result);
        if needs_attn {
            needs_attention_count += 1;
        }
        let diagnostics =
            jcode::auth::doctor::diagnostics(provider, &assessment, validation_result);
        let actions =
            jcode::auth::doctor::recommended_actions(provider, &assessment, validation_result);

        provider_reports.push(serde_json::json!({
            "id": provider.id,
            "display_name": provider.display_name,
            "status": match assessment.state {
                jcode::auth::AuthState::Available => "available",
                jcode::auth::AuthState::Expired => "expired",
                jcode::auth::AuthState::NotConfigured => "not_configured",
            },
            "configured": matches!(assessment.state, jcode::auth::AuthState::Available),
            "needs_attention": needs_attn,
            "method_detail": assessment.method_detail,
            "credential_source": assessment.credential_source.label(),
            "credential_source_detail": assessment.credential_source_detail,
            "expiry_confidence": assessment.expiry_confidence.label(),
            "refresh_support": assessment.refresh_support.label(),
            "validation_method": assessment.validation_method.label(),
            "last_validation": assessment.last_validation.as_ref().map(|r| serde_json::json!({
                "checked_at_ms": r.checked_at_ms,
                "success": r.success,
                "summary": r.summary,
                "provider_smoke_ok": r.provider_smoke_ok,
                "tool_smoke_ok": r.tool_smoke_ok,
            })),
            "last_refresh": assessment.last_refresh.as_ref().map(|r| serde_json::json!({
                "last_attempt_ms": r.last_attempt_ms,
                "last_success_ms": r.last_success_ms,
                "last_error": r.last_error,
            })),
            "diagnostics": diagnostics,
            "recommended_actions": actions,
        }));
    }

    Ok(serde_json::json!({
        "needs_attention_count": needs_attention_count,
        "provider_count": provider_reports.len(),
        "providers": provider_reports,
    }))
}
#[tauri::command]
pub fn get_auth_status() -> Result<serde_json::Value, TauriError> {
    let status = jcode::auth::AuthStatus::check();
    let validation = jcode::auth::validation::load_all();
    let providers = jcode::provider_catalog::auth_status_login_providers();
    let reports: Vec<serde_json::Value> = providers
        .into_iter()
        .map(|provider| {
            let assessment = status.assessment_for_provider(provider);
            let state_label = match assessment.state {
                jcode::auth::AuthState::Available => "available",
                jcode::auth::AuthState::Expired => "expired",
                jcode::auth::AuthState::NotConfigured => "not_configured",
            };
            serde_json::json!({
                "id": provider.id.to_string(),
                "display_name": provider.display_name.to_string(),
                "status": state_label,
                "health": assessment.health_summary(),
                "method": assessment.method_detail,
                "configured": matches!(assessment.state, jcode::auth::AuthState::Available),
                "auth_kind": provider.auth_kind.label(),
                "recommended": provider.recommended,
                "validation": validation.get(provider.id).map(|record| record.summary.clone()),
            })
        })
        .collect();
    Ok(serde_json::json!({
        "any_available": status.has_any_available(),
        "providers": reports,
    }))
}
#[tauri::command]
pub async fn get_usage_info() -> Result<serde_json::Value, TauriError> {
    let providers = jcode::usage::fetch_all_provider_usage().await;
    let reports: Vec<serde_json::Value> = providers
        .into_iter()
        .map(|provider| {
            serde_json::json!({
                "provider_name": provider.provider_name,
                "limits": provider.limits.into_iter().map(|limit| serde_json::json!({
                    "name": limit.name,
                    "usage_percent": limit.usage_percent,
                    "resets_at": limit.resets_at,
                })).collect::<Vec<_>>(),
                "extra_info": provider.extra_info.into_iter().map(|(k, v)| serde_json::json!([k, v])).collect::<Vec<_>>(),
                "hard_limit_reached": provider.hard_limit_reached,
                "error": provider.error,
            })
        })
        .collect();
    Ok(serde_json::json!({ "providers": reports }))
}
#[tauri::command]
pub async fn get_external_auth_candidates() -> Result<serde_json::Value, TauriError> {
    let candidates = jcode::external_auth::pending_external_auth_review_candidates()
        .map_err(|e| TauriError::Other(format!("Failed to check external auth sources: {e}")))?;
    let items: Vec<serde_json::Value> = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate): (usize, &_)| {
            serde_json::json!({
                "index": index,
                "provider_summary": candidate.provider_summary(),
                "source_name": candidate.source_name(),
                "path": candidate.path().display().to_string(),
            })
        })
        .collect();
    Ok(serde_json::json!({ "candidates": items, "total": items.len() }))
}
#[tauri::command]
pub async fn approve_external_auth_candidate(
    index: usize,
) -> Result<serde_json::Value, TauriError> {
    let candidates = jcode::external_auth::pending_external_auth_review_candidates()
        .map_err(|e| TauriError::Other(format!("Failed to check external auth sources: {e}")))?;
    if index >= candidates.len() {
        return Err(TauriError::Other(format!(
            "Invalid candidate index {index} (only {} available)",
            candidates.len()
        )));
    }
    let candidate = &candidates[index];
    jcode::external_auth::approve_external_auth_review_candidate(candidate)
        .map_err(|e| TauriError::Other(format!("Failed to import auth source: {e}")))?;
    let validation: String =
        jcode::external_auth::validate_external_auth_review_candidate(candidate)
            .await
            .unwrap_or_else(|e| format!("Imported but validation failed: {e}"));
    jcode::auth::AuthStatus::invalidate_cache();
    Ok(serde_json::json!({
        "imported": true,
        "provider": candidate.provider_summary(),
        "detail": validation,
    }))
}
#[tauri::command]
pub async fn check_cursor_auth_status() -> Result<serde_json::Value, TauriError> {
    let has_api_key = jcode::auth::cursor::has_cursor_api_key();
    let has_native = jcode::auth::cursor::has_cursor_native_auth();
    let has_vscdb = jcode::auth::cursor::has_cursor_vscdb_token();
    let has_auth_file = jcode::auth::cursor::has_cursor_auth_file_token();
    let preferred_source =
        jcode::auth::cursor::preferred_external_auth_source().map(|s| s.display_name().to_string());
    Ok(serde_json::json!({
        "has_api_key": has_api_key,
        "has_native_auth": has_native,
        "has_vscdb_token": has_vscdb,
        "has_auth_file_token": has_auth_file,
        "preferred_source": preferred_source,
        "available": has_api_key || has_native,
    }))
}
#[tauri::command]
pub async fn run_provider_doctor(
    provider_id: String,
    model: Option<String>,
    tier: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    use jcode::auth::provider_e2e::{run_provider_e2e, DoctorTier};
    use jcode::provider_catalog;

    // Try to find by id first, then by display_name (case-insensitive)
    let provider_id_lower = provider_id.to_ascii_lowercase();
    let profile = provider_catalog::openai_compatible_profiles()
        .iter()
        .find(|p| {
            p.id == provider_id
                || p.display_name.to_ascii_lowercase() == provider_id_lower
                || p.id == provider_id_lower
        })
        .ok_or_else(|| format!("Provider '{provider_id}' not found or not OpenAI-compatible"))?;

    let doctor_tier = match tier.as_deref() {
        Some("offline") => DoctorTier::Offline,
        Some("catalog") => DoctorTier::Catalog,
        Some("full") => DoctorTier::Full,
        _ => DoctorTier::Catalog,
    };

    // Try to load API key from env or config
    let api_key =
        provider_catalog::load_api_key_from_env_or_config(profile.api_key_env, profile.env_file);

    let api_key_ref = api_key.as_deref().filter(|k| !k.trim().is_empty());

    if doctor_tier.requires_api_key() && api_key_ref.is_none() {
        return Err(TauriError::Other(format!(
            "Provider '{provider_id}' requires an API key for {:?} tier",
            doctor_tier
        )));
    }

    let report = run_provider_e2e(*profile, api_key_ref, model.as_deref(), doctor_tier)
        .await
        .map_err(|e| TauriError::Other(format!("Provider doctor failed: {e}")))?;

    Ok(serde_json::json!({
        "provider_id": report.provider_id,
        "provider_label": report.provider_label,
        "model": report.model,
        "tier": report.tier.as_str(),
        "tier_passed": report.tier_passed,
        "strict_passed": report.strict_passed,
        "checks": report.checks.iter().map(|check| {
            serde_json::json!({
                "checkpoint": check.checkpoint,
                "label": check.label,
                "status": match check.status {
                    jcode::live_tests::LiveVerificationStageStatus::Passed => "passed",
                    jcode::live_tests::LiveVerificationStageStatus::Failed => "failed",
                    jcode::live_tests::LiveVerificationStageStatus::Skipped => "skipped",
                    jcode::live_tests::LiveVerificationStageStatus::Blocked => "blocked",
                    jcode::live_tests::LiveVerificationStageStatus::NotRun => "not_run",
                },
                "detail": check.detail,
            })
        }).collect::<Vec<_>>(),
        "spend": report.spend.to_json(),
        "spend_summary": report.spend.human_summary(),
    }))
}
#[tauri::command]
pub async fn test_provider_connection(
    provider_id: String,
) -> Result<serde_json::Value, TauriError> {
    use jcode::auth::live_provider_probes::fetch_live_openai_compatible_models;
    use jcode::provider_catalog;

    // Try to find by id first, then by display_name (case-insensitive)
    let provider_id_lower = provider_id.to_ascii_lowercase();
    let profile = provider_catalog::openai_compatible_profiles()
        .iter()
        .find(|p| {
            p.id == provider_id
                || p.display_name.to_ascii_lowercase() == provider_id_lower
                || p.id == provider_id_lower
        })
        .ok_or_else(|| format!("Provider '{provider_id}' not found or not OpenAI-compatible"))?;

    let api_key =
        provider_catalog::load_api_key_from_env_or_config(profile.api_key_env, profile.env_file);

    let api_key = api_key
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| format!("No API key found for '{provider_id}'"))?;

    let start = std::time::Instant::now();
    let models = fetch_live_openai_compatible_models(*profile, &api_key)
        .await
        .map_err(|e| TauriError::Other(format!("Connection test failed: {e}")))?;
    let elapsed = start.elapsed();

    Ok(serde_json::json!({
        "provider_id": provider_id,
        "model_count": models.len(),
        "models": models.iter().take(10).collect::<Vec<_>>(),
        "elapsed_ms": elapsed.as_millis() as u64,
        "success": true,
    }))
}
#[tauri::command]
pub async fn get_models(state: State<'_, AppState>) -> Result<serde_json::Value, TauriError> {
    let (raw_routes, current_provider_name) = if let Ok(runtime) = active_runtime(&state).await {
        let provider = { runtime.agent.lock().await.provider_handle() };
        let _ = provider.prefetch_models().await;
        let guard = runtime.agent.lock().await;
        let raw_routes = guard
            .model_routes()
            .into_iter()
            .filter(|r| jcode::provider::is_listable_model_name(&r.model))
            .collect::<Vec<_>>();
        let current = {
            let name = guard.provider_handle().name().to_string();
            if name.eq_ignore_ascii_case("openrouter") {
                std::env::var("JCODE_OPENROUTER_CACHE_NAMESPACE")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(name)
            } else {
                name
            }
        };
        (raw_routes, Some(current))
    } else {
        // No active session — create a temporary provider so users can still
        // browse and configure providers from the model picker.
        let provider = jcode::provider::MultiProvider::new();
        let _ = provider.prefetch_models().await;
        let raw_routes = provider
            .model_routes()
            .into_iter()
            .filter(|r| jcode::provider::is_listable_model_name(&r.model))
            .collect::<Vec<_>>();
        (raw_routes, None)
    };

    let routes: Vec<serde_json::Value> = raw_routes
        .iter()
        .cloned()
        .map(serialize_model_route)
        .collect();
    let providers = provider_entries_from_routes(&raw_routes, current_provider_name.as_deref());
    Ok(serde_json::json!({
        "routes": routes,
        "providers": providers,
        "current": current_provider_name.as_deref().unwrap_or(""),
    }))
}
#[tauri::command]
pub async fn get_provider_profiles(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, TauriError> {
    let (raw_routes, current_provider_name) = if let Ok(runtime) = active_runtime(&state).await {
        let provider = { runtime.agent.lock().await.provider_handle() };
        let _ = provider.prefetch_models().await;
        let guard = runtime.agent.lock().await;
        let raw_routes = guard
            .model_routes()
            .into_iter()
            .filter(|r| jcode::provider::is_listable_model_name(&r.model))
            .collect::<Vec<_>>();
        let current = {
            let name = guard.provider_handle().name().to_string();
            if name.eq_ignore_ascii_case("openrouter") {
                std::env::var("JCODE_OPENROUTER_CACHE_NAMESPACE")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(name)
            } else {
                name
            }
        };
        (raw_routes, Some(current))
    } else {
        let provider = jcode::provider::MultiProvider::new();
        let _ = provider.prefetch_models().await;
        let raw_routes = provider
            .model_routes()
            .into_iter()
            .filter(|r| jcode::provider::is_listable_model_name(&r.model))
            .collect::<Vec<_>>();
        (raw_routes, None)
    };

    let providers = provider_entries_from_profiles(&raw_routes, current_provider_name.as_deref());
    Ok(serde_json::json!({
        "providers": providers,
        "current": current_provider_name.as_deref().unwrap_or(""),
    }))
}
/// Returns the configured providers suitable for a quick launcher chat.
/// Each entry includes a default model derived from the provider's routes.
#[tauri::command]
pub async fn list_chat_providers(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, TauriError> {
    let (raw_routes, current_provider_name, current_model) =
        if let Ok(runtime) = active_runtime(&state).await {
            let provider = { runtime.agent.lock().await.provider_handle() };
            let _ = provider.prefetch_models().await;
            let guard = runtime.agent.lock().await;
            let raw_routes = guard
                .model_routes()
                .into_iter()
                .filter(|r| jcode::provider::is_listable_model_name(&r.model))
                .collect::<Vec<_>>();
            let current_provider = guard.provider_handle().name().to_string();
            let current_model = guard.provider_handle().model().to_string();
            (raw_routes, Some(current_provider), Some(current_model))
        } else {
            let provider = jcode::provider::MultiProvider::new();
            let _ = provider.prefetch_models().await;
            let raw_routes = provider
                .model_routes()
                .into_iter()
                .filter(|r| jcode::provider::is_listable_model_name(&r.model))
                .collect::<Vec<_>>();
            (raw_routes, None, None)
        };

    // Collect all listable models available for each provider profile.
    let mut provider_models: HashMap<String, Vec<String>> = HashMap::new();
    for route in &raw_routes {
        if !route.available || !jcode::provider::is_listable_model_name(&route.model) {
            continue;
        }
        if let Some(auth_id) = auth_provider_id_for_route(&route.provider, Some(&route.api_method))
        {
            let list = provider_models.entry(auth_id).or_default();
            if !list.contains(&route.model) {
                list.push(route.model.clone());
            }
        }
    }
    for models in provider_models.values_mut() {
        models.sort();
    }
    let entries = provider_entries_from_profiles(&raw_routes, current_provider_name.as_deref());

    let mut out = Vec::new();
    for entry in entries {
        let configured = entry
            .get("configured")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !configured {
            continue;
        }
        let provider_key = entry
            .get("provider_key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let display_name = entry
            .get("display_name")
            .and_then(|v| v.as_str())
            .unwrap_or(&provider_key)
            .to_string();

        // Pick a default model: the current model if it belongs to this
        // provider, otherwise the first available route for the provider.
        let mut default_model: Option<String> = None;
        if let Some(ref current) = current_model {
            if raw_routes.iter().any(|r| {
                r.model == *current
                    && auth_provider_id_for_route(&r.provider, Some(&r.api_method)).as_deref()
                        == Some(&provider_key)
            }) {
                default_model = Some(current.clone());
            }
        }
        if default_model.is_none() {
            default_model = raw_routes
                .iter()
                .find(|r| {
                    r.available
                        && auth_provider_id_for_route(&r.provider, Some(&r.api_method)).as_deref()
                            == Some(&provider_key)
                })
                .map(|r| r.model.clone());
        }

        if let Some(model) = default_model {
            let models = provider_models
                .get(&provider_key)
                .cloned()
                .unwrap_or_default();
            out.push(serde_json::json!({
                "provider_key": provider_key,
                "display_name": display_name,
                "model": model,
                "models": models,
                "is_current_provider": entry
                    .get("is_current_provider")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            }));
        }
    }

    Ok(out)
}
#[tauri::command]
pub async fn save_provider_api_key(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: Option<String>,
    provider_id: String,
    api_key: String,
    region: Option<String>,
    api_base: Option<String>,
) -> Result<(), TauriError> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err(TauriError::Other("API key cannot be empty".to_string()));
    }

    match provider_id.as_str() {
        "openrouter" => {
            jcode::cli::provider_init::save_named_api_key(
                "openrouter.env",
                "OPENROUTER_API_KEY",
                trimmed_key,
            )
            .map_err(|e| TauriError::Other(format!("Failed to save OpenRouter API key: {e}")))?;
        }
        "openai-api" => {
            jcode::cli::provider_init::save_named_api_key(
                "openai.env",
                "OPENAI_API_KEY",
                trimmed_key,
            )
            .map_err(|e| TauriError::Other(format!("Failed to save OpenAI API key: {e}")))?;
        }
        "cursor" => {
            jcode::cli::provider_init::save_named_api_key(
                "cursor.env",
                "CURSOR_API_KEY",
                trimmed_key,
            )
            .map_err(|e| TauriError::Other(format!("Failed to save Cursor API key: {e}")))?;
        }
        "jcode" => {
            jcode::cli::provider_init::save_named_api_key(
                jcode::subscription_catalog::JCODE_ENV_FILE,
                jcode::subscription_catalog::JCODE_API_KEY_ENV,
                trimmed_key,
            )
            .map_err(|e| TauriError::Other(format!("Failed to save Jcode API key: {e}")))?;

            if let Some(api_base) = api_base
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                jcode::provider_catalog::save_env_value_to_env_file(
                    jcode::subscription_catalog::JCODE_API_BASE_ENV,
                    jcode::subscription_catalog::JCODE_ENV_FILE,
                    Some(api_base),
                )
                .map_err(|e| TauriError::Other(format!("Failed to save Jcode API base: {e}")))?;
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
            .map_err(|e| TauriError::Other(format!("Failed to save Bedrock API key: {e}")))?;
            jcode::provider_catalog::save_env_value_to_env_file(
                jcode::provider::bedrock::REGION_ENV,
                jcode::provider::bedrock::ENV_FILE,
                Some(region),
            )
            .map_err(|e| TauriError::Other(format!("Failed to save Bedrock region: {e}")))?;
            jcode::env::set_var(jcode::provider::bedrock::REGION_ENV, region);
        }
        provider_id => {
            // Generic handler for OpenAI-compatible providers (deepseek, togetherai, etc.)
            let descriptor = jcode::provider_catalog::resolve_login_provider(provider_id)
                .ok_or_else(|| {
                    format!("Inline API key save is not supported for provider `{provider_id}`")
                })?;
            if let jcode::provider_catalog::LoginProviderTarget::OpenAiCompatible(profile) =
                descriptor.target
            {
                let resolved = jcode::provider_catalog::resolve_openai_compatible_profile(profile);
                jcode::cli::provider_init::save_named_api_key(
                    &resolved.env_file,
                    &resolved.api_key_env,
                    trimmed_key,
                )
                .map_err(|e| {
                    TauriError::Other(format!(
                        "Failed to save {} API key: {e}",
                        resolved.display_name
                    ))
                })?;
            } else {
                return Err(TauriError::Other(format!(
                    "Inline API key save is not supported for provider `{provider_id}`"
                )));
            }
        }
    }

    jcode::auth::AuthStatus::invalidate_cache();
    state.clear_provider().await;
    refresh_active_runtime_auth(&app_handle, &state, session_id.as_deref()).await?;
    Ok(())
}
#[tauri::command]
pub async fn start_provider_auth_flow(
    provider_id: String,
) -> Result<serde_json::Value, TauriError> {
    let provider = resolve_login_provider(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;
    let options = LoginOptions {
        print_auth_url: true,
        json: true,
        ..Default::default()
    };
    let prompt = start_scriptable_login_data(provider, None, &options)
        .await
        .map_err(|e| TauriError::from(e.to_string()))?;
    serde_json::to_value(prompt).map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn complete_provider_auth_flow(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: Option<String>,
    provider_id: String,
    input_kind: String,
    input: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    let provided_input = match input_kind.as_str() {
        "complete" => None,
        "callback_url" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Callback URL is required".to_string())?;
            Some(jcode::cli::login::ProvidedAuthInput::CallbackUrl(
                value.to_string(),
            ))
        }
        "auth_code" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Authorization code is required".to_string())?;
            Some(jcode::cli::login::ProvidedAuthInput::AuthCode(
                value.to_string(),
            ))
        }
        "auth_code_or_callback_url" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Callback URL or authorization code is required".to_string())?;
            if value.contains("://") || value.contains("code=") || value.contains("state=") {
                Some(jcode::cli::login::ProvidedAuthInput::CallbackUrl(
                    value.to_string(),
                ))
            } else {
                Some(jcode::cli::login::ProvidedAuthInput::AuthCode(
                    value.to_string(),
                ))
            }
        }
        other => {
            return Err(TauriError::Other(format!(
                "Unsupported auth completion kind `{other}`"
            )))
        }
    };

    let provider = resolve_login_provider(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;
    let options = LoginOptions {
        complete: input_kind == "complete",
        json: true,
        ..Default::default()
    };
    let (success, _) = complete_scriptable_login_data(provider, None, &options, provided_input)
        .await
        .map_err(|e| TauriError::from(e.to_string()))?;
    jcode::auth::AuthStatus::invalidate_cache();
    refresh_active_runtime_auth(&app_handle, &state, session_id.as_deref()).await?;
    serde_json::to_value(success).map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn add_provider_profile(
    name: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    auth: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    use jcode::cli::commands::provider_setup::{configure_provider_profile, ProviderAddOptions};
    let auth_arg = auth.as_deref().and_then(|a| match a {
        "bearer" => Some(jcode::cli::args::ProviderAuthArg::Bearer),
        "api-key" => Some(jcode::cli::args::ProviderAuthArg::ApiKey),
        "none" => Some(jcode::cli::args::ProviderAuthArg::None),
        _ => None,
    });
    let options = ProviderAddOptions {
        name,
        base_url,
        model,
        context_window: None,
        api_key_env: None,
        api_key,
        api_key_stdin: false,
        no_api_key: false,
        auth: auth_arg,
        auth_header: None,
        env_file: None,
        set_default: false,
        overwrite: false,
        provider_routing: false,
        model_catalog: false,
        json: false,
    };
    let report = configure_provider_profile(options).map_err(|e: anyhow::Error| e.to_string())?;
    Ok(serde_json::json!({
        "profile": report.profile,
        "config_path": report.config_path,
        "api_base": report.api_base,
        "model": report.model,
        "api_key_stored": report.api_key_stored,
        "auth": report.auth,
        "default_set": report.default_set,
    }))
}
