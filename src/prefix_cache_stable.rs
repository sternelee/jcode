//! DeepSeek prefix cache stability design (adapted from Reasonix Pillar 1)
//!
//! When profile=deepseek, this module ensures the message prefix stays byte-stable
//! across turns, maximizing DeepSeek's automatic prefix cache hit rate.
//!
//! Core invariants (adapted from Reasonix):
//! 1. Immutable Prefix: system prompt + tool specs + few-shots are fixed per session
//! 2. Append-Only Log: messages grow monotonically; no rewrites of prior turns
//! 3. Volatile Scratch: reasoning content is transient, never sent upstream
//! 4. Preflight Check: local token estimation catches oversized payloads before sending
//! 5. Turn-End Truncation: oversized tool results are shrunk at turn end

use crate::message::{ContentBlock, Message, Role, ToolDefinition};

/// DeepSeek V4 context window (1M tokens for direct API)
const DEEPSEEK_V4_CONTEXT_TOKENS: usize = 1_000_000;

/// Default context window fallback
const DEFAULT_CONTEXT_TOKENS: usize = 128_000;

/// Threshold at which we consider folding history
const HISTORY_FOLD_THRESHOLD: f64 = 0.5;
/// Tail budget after a normal fold, as fraction of ctx_max
const HISTORY_FOLD_TAIL_FRACTION: f64 = 0.2;
/// Aggressive fold threshold
const HISTORY_FOLD_AGGRESSIVE_THRESHOLD: f64 = 0.7;
/// Aggressive tail fraction
const HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION: f64 = 0.1;
/// Force summary exit threshold
const FORCE_SUMMARY_THRESHOLD: f64 = 0.8;
/// Emergency preflight threshold
const PREFLIGHT_EMERGENCY_THRESHOLD: f64 = 0.95;
/// Turn-end tool result cap in tokens
const TURN_END_RESULT_CAP_TOKENS: usize = 3000;
/// Max chars for a tool result after turn-end truncation (chars / 4 heuristic)
const TURN_END_RESULT_CAP_CHARS: usize = TURN_END_RESULT_CAP_TOKENS * 4;

/// Detect if prefix cache stable mode should be active.
///
/// This checks multiple signals that indicate the user is running against
/// DeepSeek's API (direct or via OpenRouter), where prefix-cache mechanics
/// differ from Anthropic's explicit cache-control.
pub fn is_prefix_cache_stable_mode() -> bool {
    // Primary: the OpenRouter/OpenAI-compatible cache namespace is set to deepseek
    if let Ok(namespace) = std::env::var("JCODE_OPENROUTER_CACHE_NAMESPACE") {
        if namespace.trim().eq_ignore_ascii_case("deepseek") {
            return true;
        }
    }
    // Secondary: runtime provider hint
    if let Ok(provider) = std::env::var("JCODE_RUNTIME_PROVIDER") {
        if provider.trim().eq_ignore_ascii_case("deepseek") {
            return true;
        }
    }
    // Tertiary: named provider profile active
    if let Ok(profile) = std::env::var("JCODE_NAMED_PROVIDER_PROFILE") {
        if profile.trim().eq_ignore_ascii_case("deepseek") {
            return true;
        }
    }
    false
}

/// Preflight decision before sending a request.
#[derive(Debug, Clone)]
pub struct PreflightDecision {
    /// Whether action is needed (compact or abort)
    pub needs_action: bool,
    /// Estimated token count
    pub estimate_tokens: usize,
    /// Context window size
    pub ctx_max: usize,
    /// Ratio of estimate to ctx_max
    pub ratio: f64,
}

/// Local-side preflight before sending a request — catches oversized payloads early.
///
/// Adapted from Reasonix ContextManager::decidePreflight.
pub fn preflight_check(messages: &[Message], tools: &[ToolDefinition], model: &str) -> PreflightDecision {
    let ctx_max = context_tokens_for_model(model);
    let estimate = estimate_request_tokens(messages, tools);
    let ratio = if ctx_max > 0 {
        estimate as f64 / ctx_max as f64
    } else {
        0.0
    };
    PreflightDecision {
        needs_action: ratio > PREFLIGHT_EMERGENCY_THRESHOLD,
        estimate_tokens: estimate,
        ctx_max,
        ratio,
    }
}

/// Post-usage decision after a turn's response.
#[derive(Debug, Clone)]
pub enum PostUsageAction {
    /// No action needed
    None,
    /// Fold history, keeping recent tail within budget
    Fold { tail_budget: usize, aggressive: bool },
    /// Exit turn with a forced summary
    ExitWithSummary,
}

/// Decide what to do after receiving usage data from the provider.
///
/// Adapted from Reasonix ContextManager::decideAfterUsage.
pub fn decide_after_usage(
    prompt_tokens: usize,
    model: &str,
    already_folded_this_turn: bool,
) -> PostUsageAction {
    let ctx_max = context_tokens_for_model(model);
    if ctx_max == 0 {
        return PostUsageAction::None;
    }
    let ratio = prompt_tokens as f64 / ctx_max as f64;

    if ratio > FORCE_SUMMARY_THRESHOLD {
        return PostUsageAction::ExitWithSummary;
    }
    if already_folded_this_turn {
        return PostUsageAction::None;
    }
    if ratio > HISTORY_FOLD_AGGRESSIVE_THRESHOLD {
        return PostUsageAction::Fold {
            tail_budget: (ctx_max as f64 * HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION) as usize,
            aggressive: true,
        };
    }
    if ratio > HISTORY_FOLD_THRESHOLD {
        return PostUsageAction::Fold {
            tail_budget: (ctx_max as f64 * HISTORY_FOLD_TAIL_FRACTION) as usize,
            aggressive: false,
        };
    }
    PostUsageAction::None
}

/// Estimate tokens for a request (messages + tools + overhead).
///
/// Uses jcode's standard chars/4 heuristic plus system/tool overhead.
pub fn estimate_request_tokens(messages: &[Message], tools: &[ToolDefinition]) -> usize {
    use jcode_compaction_core::{CHARS_PER_TOKEN, DEFAULT_TOKEN_BUDGET};

    let msg_chars: usize = messages
        .iter()
        .map(jcode_compaction_core::message_char_count)
        .sum();

    let tool_chars = ToolDefinition::aggregate_prompt_chars(tools);
    let total_chars = msg_chars + tool_chars;
    let msg_tokens = total_chars / CHARS_PER_TOKEN;

    // Conservative overhead for system prompt + tool definitions.
    // SYSTEM_OVERHEAD_TOKENS (18k) is calibrated for Anthropic-sized system
    // prompts; DeepSeek/OpenAI-compatible paths are typically smaller.
    let overhead = if DEFAULT_TOKEN_BUDGET >= 32000 {
        1_000
    } else {
        200
    };

    msg_tokens + overhead
}

/// Truncate oversized tool results when preparing messages for the API.
///
/// Every tool result exceeding the cap is shrunk so that subsequent turns
/// do not pay full price to re-read it. The model had the full text on the
/// turn that originally received it; later turns see a compact reminder.
///
/// Returns the number of tool results that were truncated. Operates on cloned
/// messages so the original session history is untouched.
pub fn truncate_tool_results_for_api(messages: &[Message]) -> (Vec<Message>, usize) {
    let mut truncated_count = 0usize;
    let mut result = Vec::with_capacity(messages.len());

    for msg in messages {
        let mut new_msg = msg.clone();
        if matches!(new_msg.role, Role::User) {
            for block in new_msg.content.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if content.len() > TURN_END_RESULT_CAP_CHARS {
                        let original_len = content.len();
                        let truncated_text =
                            crate::util::truncate_str(content, TURN_END_RESULT_CAP_CHARS);
                        *content = format!(
                            "{}\n\n[truncated from {} chars — re-read the source if full output needed]",
                            truncated_text, original_len
                        );
                        truncated_count += 1;
                    }
                }
            }
        }
        result.push(new_msg);
    }

    (result, truncated_count)
}

/// Context window size for a given model.
pub fn context_tokens_for_model(model: &str) -> usize {
    let model = model.trim().to_ascii_lowercase();
    if model.starts_with("deepseek-v4-") {
        DEEPSEEK_V4_CONTEXT_TOKENS
    } else {
        jcode_provider_core::context_limit_for_model(&model)
            .unwrap_or(DEFAULT_CONTEXT_TOKENS)
    }
}

/// Human-readable label for context usage ratio.
pub fn usage_ratio_label(ratio: f64) -> &'static str {
    match ratio {
        r if r >= PREFLIGHT_EMERGENCY_THRESHOLD => "critical",
        r if r >= FORCE_SUMMARY_THRESHOLD => "danger",
        r if r >= HISTORY_FOLD_AGGRESSIVE_THRESHOLD => "high",
        r if r >= HISTORY_FOLD_THRESHOLD => "elevated",
        _ => "normal",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_message(role: Role, text: &str) -> Message {
        Message {
            role,
            content: vec![ContentBlock::Text {
                text: text.to_string(),
                cache_control: None,
            }],
            timestamp: None,
            tool_duration_ms: None,
        }
    }

    fn make_tool_result(content: &str) -> Message {
        Message {
            role: Role::User,
            content: vec![ContentBlock::ToolResult {
                tool_use_id: "test-id".to_string(),
                content: content.to_string(),
                is_error: None,
            }],
            timestamp: None,
            tool_duration_ms: None,
        }
    }

    #[test]
    fn test_preflight_normal() {
        let msgs = vec![make_message(Role::User, "Hello")];
        let decision = preflight_check(&msgs, &[], "deepseek-v4-flash");
        assert!(!decision.needs_action);
        // Overhead is 1k tokens; single word is negligible
        assert!(decision.estimate_tokens < 2000, "estimate was {}", decision.estimate_tokens);
        assert_eq!(decision.ctx_max, DEEPSEEK_V4_CONTEXT_TOKENS);
    }

    #[test]
    fn test_preflight_emergency() {
        // Create enough messages to push us past the emergency threshold
        // Need > 95% of 1M tokens => > 950k tokens => > 3.8M chars total
        let chars_per_msg = DEEPSEEK_V4_CONTEXT_TOKENS / 2; // ~500k chars each
        let mut msgs = Vec::new();
        for _ in 0..10 {
            msgs.push(make_message(
                Role::User,
                &"x".repeat(chars_per_msg),
            ));
        }
        let decision = preflight_check(&msgs, &[], "deepseek-v4-flash");
        assert!(decision.needs_action, "expected emergency but ratio was {:.3}", decision.ratio);
        assert!(decision.ratio > PREFLIGHT_EMERGENCY_THRESHOLD);
    }

    #[test]
    fn test_truncate_tool_results() {
        let long_content = "x".repeat(TURN_END_RESULT_CAP_CHARS + 1000);
        let msgs = vec![make_tool_result(&long_content)];
        let (truncated, truncate_count) = truncate_tool_results_for_api(&msgs);
        assert!(truncate_count > 0);
        match &truncated[0].content[0] {
            ContentBlock::ToolResult { content, .. } => {
                assert!(content.len() <= TURN_END_RESULT_CAP_CHARS + 200);
            }
            _ => panic!("expected ToolResult"),
        }
    }

    #[test]
    fn test_truncate_skips_short_results() {
        let short_content = "short result";
        let msgs = vec![make_tool_result(short_content)];
        let (truncated, truncate_count) = truncate_tool_results_for_api(&msgs);
        assert_eq!(truncate_count, 0);
        match &truncated[0].content[0] {
            ContentBlock::ToolResult { content, .. } => {
                assert_eq!(content, short_content);
            }
            _ => panic!("expected ToolResult"),
        }
    }

    #[test]
    fn test_decide_after_usage() {
        let ctx_max = DEEPSEEK_V4_CONTEXT_TOKENS;

        assert!(
            matches!(decide_after_usage((ctx_max as f64 * 0.3) as usize, "deepseek-v4-flash", false), PostUsageAction::None)
        );
        assert!(
            matches!(decide_after_usage((ctx_max as f64 * 0.55) as usize, "deepseek-v4-flash", false), PostUsageAction::Fold { .. })
        );
        assert!(
            matches!(decide_after_usage((ctx_max as f64 * 0.75) as usize, "deepseek-v4-flash", false), PostUsageAction::Fold { aggressive: true, .. })
        );
        assert!(
            matches!(decide_after_usage((ctx_max as f64 * 0.85) as usize, "deepseek-v4-flash", false), PostUsageAction::ExitWithSummary)
        );
    }

    #[test]
    fn test_context_tokens_for_model() {
        assert_eq!(context_tokens_for_model("deepseek-v4-flash"), DEEPSEEK_V4_CONTEXT_TOKENS);
        assert_eq!(context_tokens_for_model("deepseek-v4-pro"), DEEPSEEK_V4_CONTEXT_TOKENS);
        assert_eq!(context_tokens_for_model("gpt-4"), DEFAULT_CONTEXT_TOKENS);
    }
}
