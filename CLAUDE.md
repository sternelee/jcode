# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`jcode` is a high-performance, multi-session, multi-model coding agent TUI built in Rust (edition 2024). It is a modular monolith: one product, one server, multiple attaching clients. Major capabilities: a `ratatui`/`crossterm` TUI, OAuth and direct-API provider auth, a local ONNX embedding-based memory system, a swarm for multi-agent collaboration, and self-dev mode where the agent can edit and reload its own binary. Logs go to `~/.jcode/logs/`. Detailed product docs live under `docs/` (`MODULAR_ARCHITECTURE_RFC.md`, `CRATE_OWNERSHIP_BOUNDARIES.md`, `SERVER_ARCHITECTURE.md`, `MEMORY_ARCHITECTURE.md`, etc).

## Build, lint, test, run

All commands should be wrapped with `scripts/dev_cargo.sh` instead of calling `cargo` directly. That script applies the project's standard env: adaptive job count, fast Linux linker, optional sccache, low-memory selfdev profile, embedded git-hash export, and the remote-cargo fallback. It is the supported way to run cargo for this repo.

```bash
# Quick compile check while iterating
scripts/dev_cargo.sh check

# Build the jcode binary (default features = pdf + embeddings)
scripts/dev_cargo.sh build --release

# Run a single test by name
scripts/dev_cargo.sh test <test_name_substring>

# Fast inner loop (lib + bins only) — see AGENTS.md's "fast iteration by default" rule
scripts/test_fast.sh

# Full e2e
scripts/test_e2e.sh
```

Other useful scripts in `scripts/`:
- `scripts/cargo_exec.sh` — underpins `dev_cargo.sh`; use directly when you only need a thin wrapper.
- `scripts/remote_build.sh` — offload heavy cargo to another machine (`JCODE_REMOTE_HOST=...`, `JCODE_REMOTE_CARGO=1`).
- `scripts/check_warning_budget.sh [--update]` — fail CI if `warning:` count from `cargo check -q` regresses above the baseline in `scripts/warning_budget.txt`.
- `scripts/check_code_size_budget.py`, `scripts/check_test_size_budget.py`, `scripts/check_panic_budget.py`, `scripts/check_swallowed_error_budget.py` — size/panic/quality ratchets enforced in CI.
- `scripts/check_dependency_boundaries.py` — guards that `jcode-*-types` crates do not depend on root/runtime crates (see `docs/CRATE_OWNERSHIP_BOUNDARIES.md`).
- `scripts/quick-release.sh vX.Y.Z` — local hotfix release path (Linux + macOS in parallel; see `RELEASING.md`).
- `scripts/install.sh` / `scripts/install_release.sh` — install the stable / self-dev channel into `~/.jcode/builds/`.

CI runs (`cargo fmt --all -- --check`, `cargo check --all-targets --all-features`, `cargo clippy --all-targets --all-features -- -D warnings`, the ratchets above) in `.github/workflows/ci.yml`. The mobile simulator runs in a separate job; iOS TestFlight is configured in `codemagic.yaml`.

## Workspace layout

The `Cargo.toml` is a workspace with the root crate plus ~60 sub-crates under `crates/`. The runtime is layered bottom-up, and each layer `pub use ...` re-exports the layer below it so the historical `crate::<module>` paths still resolve:

```
jcode (root: bin + cli/ + re-exports everything below)
  └─ jcode-tui        (presentation: ratatui TUI + offline video_export)
       └─ jcode-app-core  (server, agent, provider, auth, session, tool, config, …)
            └─ jcode-base     (downward-closed foundation: provider, auth, config, message, memory, telemetry)
```

Other notable crates:
- `jcode-*-types` (`-ambient-`, `-auth-`, `-background-`, `-batch-`, `-config-`, `-gateway-`, `-memory-`, `-message-`, `-selfdev-`, `-session-`, `-side-panel-`, `-task-`, `-tool-`, `-usage-`): stable DTOs/contracts. No filesystem, no network, no TUI, no globals. Limited to `serde` / `chrono` / sibling type crates.
- `jcode-core`: small cross-domain primitives only (not a dumping ground — split out into focused crates once a cluster grows).
- `jcode-embedding` (feature `embeddings`), `jcode-pdf` (feature `pdf`): heavy/optional integrations, off the default-feature-free profiles.
- `jcode-desktop`, `jcode-mobile-core`, `jcode-mobile-sim`, `ios/`: non-TUI product surfaces.
- `jcode-build-meta`: exposes git hash/date for binary self-identification. `scripts/dev_cargo.sh` sets `JCODE_BUILD_GIT_HASH` so the binary embeds the current HEAD.

`src/main.rs` is a thin entrypoint: it picks the macOS hotkey listener process, builds the multi-thread tokio runtime, and calls `jcode::run()` → `cli::startup::run()`. The real work is in `src/cli/` (clap argument parsing, command dispatch, login flows) and the re-exported `jcode_tui::*` modules. `src/lib.rs` exists mainly to re-export `jcode_tui::*` so old call sites still work.

## Inverted-dependency pattern (load-bearing)

Several modules in the lower layers must not depend on higher ones (e.g. `memory` must not depend on `skill`, `server` must not depend on `tui`, `safety` must not depend on `notifications`). The codebase solves this with a one-time registration call from `cli/startup.rs` (search for `register_` in `src/cli/startup.rs`):

- `config::on_config_reloaded` → invalidates auth/bus caches.
- `provider_catalog::register_api_key_fallback_resolver` ← `auth::external::load_api_key_for_env`.
- `safety::register_permission_notifier` ← notifications dispatcher.
- `memory::register_synthetic_entry_provider` ← skill registry.
- `session_list_cache::register_invalidator` ← TUI session picker.
- `server_spawn::register_default_server_spawner` ← CLI's server-spawn logic.

When you touch a module involved in one of these inversions, preserve the registration shape. New inversions must follow the same pattern (lower layer defines a `register_*` hook, higher layer calls it from `cli/startup.rs`); do not add direct cross-layer imports.

## Codebase rules (from AGENTS.md / CONTRIBUTING.md)

- Commit as you go, push when done. Do not leave the tree dirty if you can avoid it.
- Use `cargo check` and targeted tests while iterating; build the source when done.
- Bump `version` in `Cargo.toml` for releases; pick the bump (patch/minor/major) from the diff since the last release.
- If a build is OOM-killed, use `scripts/remote_build.sh` — do not disable safety checks to fit a build in memory.
- PRs are treated as proposals, not direct merges — the maintainer often rewrites large/generated changes. Keep PRs focused, include repros and notes on tradeoffs.

## Things to avoid

- Do not add `dependencies` from a `jcode-*-types` crate to root/runtime/TUI/provider/storage crates — `scripts/check_dependency_boundaries.py` will fail the change. If a type truly needs a runtime dependency, that is a signal to either move the behavior with the type or split a focused domain crate.
- Do not bypass `scripts/dev_cargo.sh` and call `cargo` directly in long-running shell calls — you lose the linker/job-count/env wiring.
- Do not split a module out of the root crate purely for tidiness. The split has to reduce root churn or shrink the dependency fan-out; see the "Compile-speed decision rule" in `docs/CRATE_OWNERSHIP_BOUNDARIES.md`.
- Do not add error swallowing, panic-prone patterns, oversized files, or oversized tests without a deliberate reason — the four `_budget.py` ratchets will fail the PR.
