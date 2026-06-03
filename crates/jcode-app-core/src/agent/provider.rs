use super::*;

impl Agent {
    pub fn set_premium_mode(&self, mode: crate::provider::copilot::PremiumMode) {
        self.provider.set_premium_mode(mode);
    }

    pub fn premium_mode(&self) -> crate::provider::copilot::PremiumMode {
        self.provider.premium_mode()
    }

    pub fn provider_fork(&self) -> Arc<dyn Provider> {
        self.provider.fork()
    }

    pub fn provider_handle(&self) -> Arc<dyn Provider> {
        Arc::clone(&self.provider)
    }

    pub fn available_models(&self) -> Vec<&'static str> {
        self.provider.available_models()
    }

    pub fn available_models_for_switching(&self) -> Vec<String> {
        self.provider.available_models_for_switching()
    }

    pub fn available_models_display(&self) -> Vec<String> {
        self.provider.available_models_display()
    }

    pub fn model_routes(&self) -> Vec<crate::provider::ModelRoute> {
        self.provider.model_routes()
    }

    pub fn model_catalog_snapshot(&self) -> jcode_provider_core::ModelCatalogSnapshot {
        jcode_provider_core::ModelCatalogSnapshot::new(
            Some(self.provider_name()),
            Some(self.provider_model()),
            self.available_models_display(),
            self.model_routes(),
        )
    }

    pub fn registry(&self) -> Registry {
        self.registry.clone()
    }

    pub async fn compaction_mode(&self) -> crate::config::CompactionMode {
        self.registry.compaction().read().await.mode()
    }

    pub async fn set_compaction_mode(&self, mode: crate::config::CompactionMode) -> Result<()> {
        let compaction = self.registry.compaction();
        let mut manager = compaction.write().await;
        manager.set_mode(mode);
        Ok(())
    }

    pub fn provider_messages(&mut self) -> Vec<Message> {
        self.session.messages_for_provider()
    }

    pub fn set_model(&mut self, model: &str) -> Result<()> {
        self.set_model_from_provider_state_event(
            model,
            crate::provider::ProviderModelSelectionSource::User,
        )
    }

    /// Build a fresh `Arc<dyn Provider>` for `name` and swap it
    /// in for `self.provider`. The name is one of the short ids
    /// the TUI's `set_provider:<name>` debug command accepts:
    /// `"claude"`, `"openai"`, `"openrouter"`, `"cursor"`,
    /// `"copilot"`, `"gemini"`, `"antigravity"`, `"ollama"`.
    ///
    /// For most names we construct a fresh `MultiProvider::new()`;
    /// the multi-provider's own env-driven account failover and
    /// auth detection then picks the right concrete provider
    /// (e.g. Claude Code CLI subscription if `claude` is on PATH,
    /// else the Anthropic API key from `ANTHROPIC_API_KEY`).
    /// Ollama is a special case: we hit `localhost:11434` directly
    /// with no auth.
    ///
    /// After the swap, the agent's `selected_model` field is
    /// reset to a sensible default for the new provider and the
    /// next `available_models_display()` reflects the new list.
    pub fn set_provider(&mut self, name: &str) -> Result<String> {
        use crate::provider::{MultiProvider, Provider as _};
        let trimmed = name.trim();
        let lower = trimmed.to_ascii_lowercase();
        let new_provider: Arc<dyn Provider> = match lower.as_str() {
            // No-auth local model servers. We still go through
            // MultiProvider because the multi-provider detects an
            // Ollama endpoint when one is configured via env.
            "ollama" | "lmstudio" | "lm-studio" | "local" => {
                let p = MultiProvider::new();
                let _ = p.set_model("llama3.2");
                Arc::new(p)
            }
            // Subscription / OAuth providers.
            "claude" | "anthropic" => Arc::new(MultiProvider::new()),
            "openai" | "codex" | "gpt" => {
                let p = MultiProvider::new_fast();
                let _ = p.set_model("gpt-5.5");
                Arc::new(p)
            }
            "openrouter" => {
                let p = MultiProvider::new();
                let _ = p.set_model("anthropic/claude-sonnet-4");
                Arc::new(p)
            }
            "copilot" | "gh-copilot" => {
                let p = MultiProvider::new_fast();
                let _ = p.set_model("copilot:claude-sonnet-4");
                Arc::new(p)
            }
            "gemini" | "google" => {
                let p = MultiProvider::new();
                let _ = p.set_model("gemini-2.5-pro");
                Arc::new(p)
            }
            "antigravity" => {
                let p = MultiProvider::new();
                let _ = p.set_model("default");
                Arc::new(p)
            }
            "cursor" => {
                let p = MultiProvider::new();
                let _ = p.set_model("gpt-5");
                Arc::new(p)
            }
            _ => {
                return Err(anyhow::anyhow!(
                    "Unknown provider '{}'. Available: claude, openai, openrouter, copilot, gemini, antigravity, cursor, ollama",
                    trimmed
                ));
            }
        };

        // Swap the provider in place. The session's per-provider
        // state (model id, route, etc.) is reset because the
        // new provider likely has a different default.
        let old_provider_model = self.provider_model();
        self.provider = new_provider;
        // Best-effort: pick a sensible default for the new provider.
        // If the provider is freshly built (no env detection yet)
        // the default model is just a placeholder; the user can
        // pick another from the model picker in the next frame.
        let default_model = self.provider_model();
        // Reset session state to match.
        self.session.model = Some(default_model.clone());
        self.session.provider_key = None;
        self.session.route_api_method = None;
        // Persist: write the new model + a clear provider
        // discriminator so the next launch picks the same one.
        self.persist_session_best_effort("set_provider");
        crate::logging::info(&format!(
            "Agent::set_provider: swapped {} → {} (model now {})",
            old_provider_model, lower, default_model
        ));
        Ok(default_model)
    }

    /// Snapshot of currently-available models for the active
    /// provider. Returns an empty list if the provider hasn't
    /// finished its env-detection pass yet (callers should retry
    /// after a moment).
    pub fn available_model_list(&self) -> Vec<String> {
        self.provider.available_models_display()
    }

    pub fn set_route_selection(
        &mut self,
        selection: &crate::provider::RouteSelection,
    ) -> Result<()> {
        self.provider.set_route_selection(selection)?;
        let resolved_model = self.provider.model();
        self.session.provider_key = Some(selection.runtime_key.stable_id());
        self.session.route_api_method = Some(selection.api_method.clone());
        self.session.model = Some(resolved_model.clone());
        let event = crate::provider::ProviderStateEvent::selected_model(
            crate::provider::ProviderModelSelectionSource::User,
            resolved_model,
        );
        self.provider_runtime_state.apply(event);
        self.persist_session_best_effort("route selection");
        self.log_env_snapshot("set_route_selection");
        Ok(())
    }

    pub(crate) fn set_model_from_auth(&mut self, model: &str) -> Result<()> {
        self.set_model_from_provider_state_event(
            model,
            crate::provider::ProviderModelSelectionSource::Auth,
        )
    }

    fn set_model_from_provider_state_event(
        &mut self,
        model: &str,
        source: crate::provider::ProviderModelSelectionSource,
    ) -> Result<()> {
        crate::provider::set_model_with_auth_refresh(self.provider.as_ref(), model)?;
        let resolved_model = self.provider.model();
        self.session.provider_key =
            crate::provider::MultiProvider::session_provider_key_after_model_switch(
                model,
                self.provider.name(),
                self.session.provider_key.as_deref(),
            );
        self.session.model = Some(resolved_model.clone());
        let event = crate::provider::ProviderStateEvent::selected_model(source, resolved_model);
        self.provider_runtime_state.apply(event);
        self.persist_session_best_effort("model selection");
        self.log_env_snapshot("set_model");
        Ok(())
    }

    pub(crate) fn provider_model_selection_generation(&self) -> u64 {
        self.provider_runtime_state.selection_generation()
    }

    pub(crate) fn user_selected_provider_model_after(&self, generation: u64) -> bool {
        self.provider_runtime_state.user_selected_after(generation)
    }

    pub fn restore_reasoning_effort_from_session(&mut self) {
        if let Some(effort) = self.session.reasoning_effort.clone() {
            if let Err(e) = self.provider.set_reasoning_effort(&effort) {
                crate::logging::error(&format!(
                    "Failed to restore session reasoning effort '{}': {}",
                    effort, e
                ));
            }
        } else {
            self.session.reasoning_effort = self.provider.reasoning_effort();
        }
    }

    pub fn set_reasoning_effort(&mut self, effort: &str) -> Result<Option<String>> {
        self.provider.set_reasoning_effort(effort)?;
        let current = self.provider.reasoning_effort();
        self.session.reasoning_effort = current.clone();
        self.log_env_snapshot("set_reasoning_effort");
        self.session.save()?;
        Ok(current)
    }

    pub fn subagent_model(&self) -> Option<String> {
        self.session.subagent_model.clone()
    }

    pub fn set_subagent_model(&mut self, model: Option<String>) -> Result<()> {
        self.session.subagent_model = model;
        self.log_env_snapshot("set_subagent_model");
        self.session.save()?;
        Ok(())
    }

    pub fn session_provider_key(&self) -> Option<String> {
        self.session.provider_key.clone()
    }

    pub fn set_session_provider_key(&mut self, provider_key: Option<String>) {
        self.session.provider_key = provider_key;
    }

    pub fn rename_session_title(&mut self, title: Option<String>) -> Result<String> {
        self.session.rename_title(title);
        self.log_env_snapshot("rename_session");
        self.session.save()?;
        Ok(self.session.display_title_or_name().to_string())
    }

    pub fn autoreview_enabled(&self) -> Option<bool> {
        self.session.autoreview_enabled
    }

    pub fn set_autoreview_enabled(&mut self, enabled: bool) -> Result<()> {
        self.session.autoreview_enabled = Some(enabled);
        self.log_env_snapshot("set_autoreview_enabled");
        self.session.save()?;
        Ok(())
    }

    pub fn autojudge_enabled(&self) -> Option<bool> {
        self.session.autojudge_enabled
    }

    pub fn set_autojudge_enabled(&mut self, enabled: bool) -> Result<()> {
        self.session.autojudge_enabled = Some(enabled);
        self.log_env_snapshot("set_autojudge_enabled");
        self.session.save()?;
        Ok(())
    }

    /// Set the working directory for this session
    pub fn set_working_dir(&mut self, dir: &str) {
        if self.session.working_dir.as_deref() == Some(dir) {
            return;
        }
        self.session.working_dir = Some(dir.to_string());
        self.session.refresh_initial_session_context_message();
        self.log_env_snapshot("working_dir");
    }

    /// Get the working directory for this session
    pub fn working_dir(&self) -> Option<&str> {
        self.session.working_dir.as_deref()
    }

    /// Get the stored messages (for transcript export)
    pub fn messages(&self) -> &[StoredMessage] {
        &self.session.messages
    }
}
