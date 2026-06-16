# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**jcode** is a high-performance AI coding agent built in Rust. It supports interactive TUI use, non-interactive runs, persistent server/client workflows, and a Tauri v2 desktop app. The repo is a Rust workspace with 60+ crates.

Key surfaces:
- **TUI** (`src/main.rs` → `jcode::run()`) — terminal UI using ratatui, presented via the `jcode-tui` crate
- **Server** (`jcode serve`) — Unix socket server for multi-client sessions
- **Desktop** (`jcode-app/`) — Tauri v2 + React 19 + TypeScript. See `jcode-app/CLAUDE.md` for Tauri-specific guidance
- **iOS** (`ios/`) — XcodeGen-based iOS app
- **Telemetry** (`telemetry-worker/`) — Cloudflare Workers service

## Quick Start

```bash
# Launch the interactive TUI
jcode

# Run a single command non-interactively
jcode run "say hello"

# Resume a previous session by memorable name
jcode --resume fox

# Run as a persistent background server, then attach more clients
jcode serve
jcode connect
```

## Crate Layering

The root `jcode` crate (`src/lib.rs`, `src/main.rs`) is a thin entrypoint. The real work lives in:

```
src/lib.rs               # re-exports jcode_tui::* + pub mod cli
  └─→ crates/jcode-tui   # presentation (TUI rendering, video export)
        ├─→ crates/jcode-app-core   # non-presentation application logic
        │     └─→ crates/jcode-base # lowest-level cross-cutting helpers
        └─→ (other deps)
src/cli/                 # CLI dispatch + commands (kept in root crate)
```

`pub use jcode_tui::*` keeps the historical `crate::<module>` paths (`crate::config`, `crate::server`, `crate::tui`, etc.) resolving from the root crate. When exploring, the *real* sources are:

- `crates/jcode-tui/src/` — TUI rendering, info widgets, app shell
- `crates/jcode-app-core/src/` — `agent/`, `server/`, `session*`, `protocol*`, `provider.rs`, `tool/`, `config/`, `memory*`, `safety`, `compaction`, `ambient/`, `overnight`, `notifications`, `external_auth`, etc.
- `crates/jcode-base/src/` — `config/`, `auth`, `browser`, `compaction`, `embedding`, `gateway`, `id`, `notifications`, `tool` (lowest layer)
- `crates/jcode-tui-{core,render,messages,markdown,mermaid,tool-display,session-picker,account-picker,usage-overlay,workspace,style}` — TUI building blocks

`src/cli/` contains `cli/args.rs`, `cli/commands.rs`, `cli/dispatch.rs`, `cli/auth_test.rs`, `cli/login/`, `cli/provider_init.rs`, `cli/selfdev.rs`, `cli/tui_launch/`, etc.

> **Note:** `crates/jcode-desktop/` is a separate wgpu/winit native desktop experiment — **not** the shipping desktop app. The shipping desktop is `jcode-app/` (Tauri).

## Build Commands

Fast iteration (preferred):
```bash
# Check only (no link)
cargo check

# Check all targets and features (CI gate)
cargo check --all-targets --all-features

# Dev build with auto-configured linker/cache
scripts/dev_cargo.sh build
```

Full build & install:
```bash
# Self-dev install (symlinks into ~/.jcode/builds/current/ and ~/.local/bin/jcode)
scripts/install_release.sh

# Fast self-dev install (no LTO)
scripts/install_release.sh --fast

# Remote build (SSH + rsync)
scripts/remote_build.sh --release
```

Release profiles (from `Cargo.toml`):
| Profile | Opt-level | LTO | Codegen Units | Use |
|---------|-----------|-----|---------------|-----|
| `dev` | 0 | off | 256 | Fast compilation during development |
| `test` | 0 | off | 256 | Test builds |
| `release` | 1 | off | 256 | Fast release (not for distribution) |
| `release-lto` | 3 | thin | 16 | Distribution builds, CI releases |
| `selfdev` | 0 (inherits release) | off | 256 | Self-dev install path |

- `cargo build --release` — Fast release. **Not** the distribution build.
- `cargo build --profile release-lto` — True release. Used by `install_release.sh` and CI.
- `scripts/build_linux_compat.sh dist` — Portable Linux x86_64 release in CentOS 7 container.

## Feature Flags

Defined in root `Cargo.toml`:

| Flag | Purpose |
|------|---------|
| `default = ["pdf", "embeddings"]` | PDF parsing + local ONNX/tokenizer embeddings ON by default |
| `embeddings` | Local ONNX/tokenizer stack. **Default-on** despite ~163 extra crates; opt-out via `JCODE_DEV_FEATURE_PROFILE=minimal` |
| `pdf` | PDF parsing via `jcode-pdf` crate |
| `dev-bins` | Extra dev binaries (`session_memory_bench`, `mermaid_side_panel_probe`, `tui_bench`) |
| `jemalloc` | jemalloc allocator with stats |
| `jemalloc-prof` | jemalloc with profiling support |
| `mmdr-size-api` | Mermaid diagram size API |

`scripts/dev_cargo.sh` is the preferred build wrapper on Linux x86_64. It auto-detects sccache and fast linkers (lld/mold + clang). Set `JCODE_DEV_FEATURE_PROFILE` to `default`, `minimal`, `pdf`, `embeddings`, or `full`.

## Test Commands

```bash
# Fast loop (lib + bins + startup budget check)
scripts/test_fast.sh

# Single crate
cargo test -p <crate-name>

# Specific test (optionally scope to a crate)
cargo test -p <crate-name> <test_name> -- --nocapture

# Integration tests
cargo test --test e2e
cargo test --test provider_matrix

# Mobile tests
cargo test -p jcode-mobile-core -p jcode-mobile-sim

# Full suite
scripts/test_e2e.sh

# Real provider tests (optional)
JCODE_REAL_PROVIDER=1 scripts/real_provider_smoke.sh
JCODE_REAL_AUTH_TEST=1 scripts/test_auth_e2e.sh
```

Test layout:
- `#[cfg(test)] mod tests` inline at the bottom of most `src/` modules
- `tests/e2e/` integration tests with mock provider (`tests/e2e/mock_provider.rs`)
- `tests/e2e/test_support/` provides `TestEnvGuard`, `EnvVarGuard`, mock transport
- `tests/provider_matrix.rs` — across provider implementations
- `tests/auth_login_flow.rs` — OAuth/device auth flow
- `crates/jcode-mobile-core/tests/` — mobile-specific

Patterns: `#[tokio::test]` for async; manual test doubles (no `mockall`); environment variable guards for isolation.

## Lint & Quality Gates

Run before pushing:
```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
scripts/check_warning_budget.sh
python3 scripts/check_code_size_budget.py
python3 scripts/check_test_size_budget.py
python3 scripts/check_panic_budget.py
python3 scripts/check_swallowed_error_budget.py
python3 scripts/check_dependency_boundaries.py   # enforces crate ownership rules
```

There is no `rustfmt.toml` or `clippy.toml` — defaults apply.

The project enforces quality via ratcheting budgets (can only improve, never regress):
- **Code size**: files over 1200 lines tracked in `scripts/code_size_budget.json`
- **Warning budget**: compiler warnings counted, must not increase
- **Panic budget**: grep for `panic!` / `unreachable!` / `unwrap` patterns
- **Swallowed error budget**: grep for `let _ =` on `Result`s
- **Test size budget**: large test files tracked
- **Dependency boundaries**: per `docs/CRATE_OWNERSHIP_BOUNDARIES.md`

Run `--update` flag on budget scripts after intentional cleanup to reset baselines.

## Architecture

### Top-Level Data Flow

```
User Input → TUI / Desktop / Client → Agent → Provider(s) → StreamEvent → Protocol → UI
                                       │
                                       ├── Tool System (filesystem, git, web, shell, etc.)
                                       ├── Session (history, state, git context)
                                       ├── Memory Graph (persistent knowledge)
                                       └── Safety System (permission gating)
```

### Communication Modes

| Mode | Flow |
|------|------|
| **TUI** (direct) | `jcode::run()` → Agent → Session (in-process) |
| **Server** | Client ↔ Unix socket ↔ Server ↔ Session ↔ Agent |
| **Desktop** (Tauri) | Frontend `invoke()` → Tauri command → Agent → `server-event` → Frontend listener |

### Key Architectural Layers

1. **`Agent`** — orchestrates turn loops: sends messages to provider, dispatches tool calls, builds prompts
2. **`Provider`** — `async_trait Provider` in `jcode-provider-core`. Implementations include OpenAI, Gemini, OpenRouter, AWS Bedrock, Anthropic, Copilot, Cursor, Antigravity, and many OpenAI-compatible endpoints. Returns `EventStream` (pinned `Stream<Item = Result<StreamEvent>>`)
3. **`Tool`** — `async_trait Tool` in `jcode-tool-core`. Each tool gets a `ToolContext` (session_id, working_dir, interrupt signals). 37+ base tools: bash, file ops, git, web search, browser, memory, communicate/swarm, batch, MCP, selfdev, etc.
4. **`Session`** — owns conversation history, git state, model selection, memory config. Persisted via `jcode-storage`
5. **`Protocol`** — `ServerEvent` enum in `jcode-protocol` — newline-delimited JSON over Unix socket (main socket for client communication; agent socket for AI-to-AI)
6. **`Server`** — named with adjective+animal (e.g. "🔥 blazing 🦊 fox"), registry at `~/.jcode/servers.json`, transparent reconnect on `/reload`

### Agent Submodules (`crates/jcode-app-core/src/agent/`)

The agent is the core orchestrator. Submodules:
- `turn_execution.rs` / `turn_loops.rs` — Main turn loop
- `streaming.rs` / `turn_streaming_broadcast.rs` / `turn_streaming_mpsc.rs` — Event streaming
- `tools.rs` — Tool execution and result handling
- `provider.rs` — Provider interaction within the agent
- `messages.rs` — Message building and history management
- `prompting.rs` — Prompt construction
- `status.rs` — Agent status tracking
- `interrupts.rs`, `compaction.rs`, `environment.rs`, `response_recovery.rs`, `utils.rs`

Cross-cutting concerns (signals, soft interrupts, stream errors, graceful shutdown) live in `crates/jcode-agent-runtime`.

### Server Architecture

`crates/jcode-app-core/src/server.rs` and `server/` subdirectory. Single-server, multi-client over Unix sockets. See `docs/SERVER_ARCHITECTURE.md`.
- Server named with adjective+animal (e.g., "🔥 blazing 🦊 fox")
- Registry at `~/.jcode/servers.json`
- MCP pool shared across sessions
- Supports transparent reconnect after server reload (`/reload` execs new binary)

## Important Files

| File | Purpose |
|------|---------|
| `src/main.rs` | Entry point, global allocator (jemalloc), tokio runtime bootstrap |
| `src/lib.rs` | Module declarations, `run()` entry point, session ID global |
| `src/cli/startup.rs` | Startup orchestration and dependency-inversion callbacks |
| `src/cli/dispatch.rs` | Command dispatcher |
| `src/cli/args.rs` | clap CLI argument definitions |
| `Cargo.toml` | Workspace definition, members, dependencies, features, profiles |
| `crates/jcode-protocol/src/lib.rs` / `wire.rs` | `Request` and `ServerEvent` |
| `crates/jcode-provider-core/src/lib.rs` | `Provider` trait, `EventStream` |
| `crates/jcode-tool-core/src/lib.rs` | `Tool` trait, `ToolContext` |
| `crates/jcode-agent-runtime/src/lib.rs` | `InterruptSignal`, `SoftInterruptMessage`, `StreamError` |
| `crates/jcode-base/src/config.rs` | Hot-reloadable config |
| `crates/jcode-base/src/session.rs` | Session model |
| `crates/jcode-app-core/src/agent/turn_loops.rs` | Main agent turn loop (orchestration; execution logic is in `turn_execution.rs`) |
| `crates/jcode-app-core/src/server.rs` | Server module and client request dispatch |
| `crates/jcode-app-core/src/tool/mod.rs` | Tool registry |
| `jcode-app/src-tauri/src/lib.rs` | Tauri commands and event streaming |

## Cross-Cutting Patterns

### Dependency Inversion

Several lower-layer crates expose registration hooks so higher layers can inject behavior without creating reverse dependencies. All of these are wired in `src/cli/startup.rs`:

- `safety::register_permission_notifier()` — safety raises requests; notifications layer delivers them
- `config::on_config_reloaded(...)` — invalidate auth cache and broadcast model updates on config reload
- `memory::register_synthetic_entry_provider()` — memory collects synthetic entries from the skill registry
- `server_spawn::register_default_server_spawner()` — TUI reconnect can spawn a replacement server without depending on CLI
- `session_list_cache::register_invalidator(...)` — server can drop the TUI session-list cache without referencing TUI
- `provider_catalog::register_api_key_fallback_resolver(...)` — auth layer supplies fallback API-key resolution

When adding a new cross-cutting concern, prefer registering a callback over introducing a new crate dependency.

### Self-Development Mode

`jcode` can modify its own source code, build, and reload its binary to continue work across sessions. The `/selfdev` command (or `jcode selfdev`) enters this mode. It uses the tool registry in `crates/jcode-app-core/src/tool/selfdev/` and a dedicated build queue. Use a frontier model for self-dev; weaker models can introduce subtle breaking changes.

### Browser Automation

The built-in `browser` tool controls Firefox via the Firefox Agent Bridge. Setup and status:

```bash
jcode browser status
jcode browser setup
```

Actions include `open`, `snapshot`, `click`, `type`, `fill_form`, `select`, `screenshot`, `eval`, `scroll`, `upload`, and others. See `docs/BROWSER_PROVIDER_PROTOCOL.md`.

### MCP Configuration

MCP config is separate from `config.toml`:

- `~/.jcode/mcp.json` — global MCP servers
- `.jcode/mcp.json` — project-local MCP servers
- `.claude/mcp.json` — compatibility fallback

On first run, jcode imports MCP servers from `~/.claude/mcp.json` and `~/.codex/config.toml` if `~/.jcode/mcp.json` does not exist.

## Code Conventions

### Error Handling

- **Application code** (`src/`, `crates/jcode-app-core/`): uses `anyhow::Result` pervasively
- **Library crates**: use `thiserror` for structured error types (e.g., `StreamError` in `jcode-agent-runtime`)
- **Panics**: rare; budget-enforced via `scripts/check_panic_budget.py` using grep patterns
- **Swallowed errors**: `let _ = ...` patterns are budget-enforced via `scripts/check_swallowed_error_budget.py`

### Async Patterns

- **Runtime**: `tokio` (multi-threaded, with fs, process, net, signal, sync, time features)
- **Traits**: `#[async_trait]` on `Provider`, `Tool`, and other trait objects
- **Streaming**: `Pin<Box<dyn Stream<Item = Result<T>> + Send>>` for provider event streams
- **Channels**: `tokio::sync::mpsc` (unbounded for stdin requests), `tokio::sync::broadcast` (server events), `tokio::sync::oneshot` (request-response)
- **Signals**: `Arc<AtomicBool>` for graceful shutdown, `InterruptSignal` (AtomicBool + Notify) for async-aware interruption
- **Select**: `tokio::select!` used in turn loops for cancellation/interruption

### Serialization

- `serde` + `serde_json` everywhere; `serde_yaml` and `toml` for config
- `#[serde(rename_all = "snake_case")]` on enums sent over the wire
- Transparent newtypes via `#[serde(transparent)]` for type-safe IDs (e.g., `AuthProviderId`, `RuntimeProviderKey`)
- `serde_json::Value` for tool parameters (dynamic schemas)

### State & Dependency Injection

- **Config**: `LazyLock<RwLock<Config>>` pattern for global config; cached with 500ms staleness check
- **Tool context**: `ToolContext` struct passed to every tool invocation (session_id, working_dir, interrupt signals)
- **Agent runtime**: signals (`InterruptSignal`, `SoftInterruptQueue`) shared via `Arc` for cross-task communication
- **Server**: `AppState` in Tauri holds session runtime; `OnceLock` for singletons

### Module Conventions

- Module files use `mod.rs` pattern (not `foo.rs` alongside `foo/` directory)
- Inline test modules: `#[cfg(test)] mod tests { ... }` at bottom of source files, or `_tests.rs` sibling files
- Feature-gated modules use `#[cfg(feature = "...")]` on `pub mod` declarations in `lib.rs`
- Re-exports: types defined in `jcode-*-types` crates are re-exported from their corresponding `-core` or main crate

### Naming Conventions

- **Crates**: `jcode-<domain>` prefix for all workspace crates
- **Config keys**: `SCREAMING_SNAKE_CASE` for env vars (`JCODE_AMBIENT_ENABLED`), `snake_case` in TOML
- **Server**: random adjective/verb name (e.g., "blazing", "frozen", "swift")
- **Sessions**: animal nouns (e.g., "fox", "bear", "owl")
- **IDs**: opaque newtypes over `String` with `::new()` and `::as_str()` methods

## Important Notes

- `scripts/dev_cargo.sh --print-setup` shows active linker/cache configuration.
- Git dependency on `agentgrep` via HTTPS (`https://github.com/1jehuang/agentgrep.git`, tag `v0.1.2`).
- Logs: `~/.jcode/logs/jcode-YYYY-MM-DD.log`
- Install paths: `~/.local/bin/jcode` (launcher), `~/.jcode/builds/current/` (self-dev), `~/.jcode/builds/stable/` (release).
- Windows ARM64 builds use `--no-default-features --features pdf` due to upstream `ring`/`cargo-xwin` limitations.
- CI: `.github/workflows/ci.yml` (build+test+lint all platforms), `release.yml` (multi-platform builds), `windows-smoke.yml`.

## References

- `jcode-app/CLAUDE.md` — Tauri desktop app guidance
- `AGENTS.md` — Full repo guidelines (build, test, release, iOS, etc.)
- `docs/SERVER_ARCHITECTURE.md` — server design and lifecycle
- `docs/SWARM_ARCHITECTURE.md` — multi-agent swarm coordination
- `docs/MEMORY_ARCHITECTURE.md` — persistent memory graph system
- `docs/MEMORY_GRAPH_PLAN.md` — memory graph implementation plan
- `docs/AMBIENT_MODE.md` — background/ambient agent mode
- `docs/SAFETY_SYSTEM.md` — permission gating and safety
- `docs/BROWSER_PROVIDER_PROTOCOL.md` — browser automation protocol
- `docs/CRATE_OWNERSHIP_BOUNDARIES.md` — crate dependency rules
- `docs/MODULAR_ARCHITECTURE_RFC.md` — crate modularization RFC
- `docs/REFACTORING.md` — ongoing refactor notes
