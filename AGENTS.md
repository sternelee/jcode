# Repository Guidelines

## Project Overview

**jcode** is a high-performance AI coding agent built in Rust. It supports:
- **Interactive TUI** (ratatui + crossterm) — primary interface
- **Server/Client mode** — single-server, multi-client over Unix sockets
- **Desktop app** (`jcode-app/`) — Tauri v2 + React 19 + TypeScript + Tailwind v4
- **iOS app** (`ios/`) — XcodeGen-based
- **Telemetry service** (`telemetry-worker/`) — Cloudflare Workers + D1

Rust workspace with 60+ crates under `crates/` plus the main binary/lib in `src/`.

## Architecture & Data Flow

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
| **TUI** | `jcode::run()` → Agent → Session (in-process) |
| **Server** | Client ↔ Unix socket ↔ Server ↔ Session ↔ Agent |
| **Desktop** | Frontend `invoke()` → Tauri command → Agent → `server-event` → Frontend listener |

### Crate Layering

The root `jcode` crate (`src/lib.rs`, `src/main.rs`) is a thin entrypoint. Real work lives in:

```
src/lib.rs               # re-exports jcode_tui::* + pub mod cli
  └─→ crates/jcode-tui   # presentation (TUI rendering, video export)
        ├─→ crates/jcode-app-core   # non-presentation app logic
        │     └─→ crates/jcode-base # lowest-level cross-cutting helpers
        └─→ (other deps)
src/cli/                 # CLI dispatch + commands (kept in root crate)
```

`pub use jcode_tui::*` keeps historical `crate::<module>` paths resolving from the root crate. When exploring, the *real* sources are:
- `crates/jcode-tui/src/` — TUI rendering, info widgets, app shell
- `crates/jcode-app-core/src/` — `agent/`, `server/`, `session*`, `protocol*`, `provider.rs`, `tool/`, `config/`, `memory*`, `safety`, `compaction`, `ambient/`, `overnight`, `notifications`, `external_auth`, etc.
- `crates/jcode-base/src/` — `config/`, `auth`, `browser`, `compaction`, `embedding`, `gateway`, `id`, `notifications`, `tool` (lowest layer)

> **Note:** `crates/jcode-desktop/` is a separate wgpu/winit native desktop experiment — **not** the shipping desktop app. The shipping desktop is `jcode-app/` (Tauri).

### Key Architectural Layers

1. **`Agent`** — orchestrates turn loops: sends messages to provider, dispatches tool calls, builds prompts
2. **`Provider`** — `async_trait Provider` in `jcode-provider-core`. Implementations: OpenAI, Gemini, OpenRouter, AWS Bedrock. Returns `EventStream` (pinned `Stream<Item = Result<StreamEvent>>`)
3. **`Tool`** — `async_trait Tool` in `jcode-tool-core`. Each tool gets a `ToolContext` (session_id, working_dir, interrupt signals). 30+ tools: bash, file ops, git, web search, browser, etc.
4. **`Session`** — owns conversation history, git state, model selection, memory config. Persisted via `jcode-storage`
5. **`Protocol`** — `ServerEvent` enum in `jcode-protocol` — newline-delimited JSON over Unix socket
6. **`Server`** — named with adjective+animal (e.g. "🔥 blazing 🦊 fox"), registry at `~/.jcode/servers.json`, transparent reconnect on `/reload`

### Crate Organization

**Core abstractions** (types only, no logic):
- `jcode-core` — shared utilities (env, fs, id generation, panic helpers)
- `jcode-session-types` — session state type definitions
- `jcode-message-types` — `Message`, `ContentBlock`, `StreamEvent`, `ToolDefinition`, `Role`
- `jcode-tool-types` — `ToolOutput`, tool result types
- `jcode-config-types` — all config structs with serde derives
- `jcode-protocol` — `ServerEvent` enum, `CommRequest`, `CommResponse`, transport wire format
- `jcode-memory-types` — memory graph node/edge types
- `jcode-swarm-core` — swarm coordination types
- `jcode-plan` — `PlanItem`, `VersionedPlan`
- `jcode-task-types` / `jcode-batch-types` / `jcode-background-types` / `jcode-ambient-types` / `jcode-selfdev-types` / `jcode-usage-types` / `jcode-gateway-types` / `jcode-auth-types` / `jcode-side-panel-types`

**Behavior crates**:
- `jcode-provider-core` — `Provider` trait, model selection, failover, pricing, catalog refresh
- `jcode-provider-openai` / `-gemini` / `-openrouter` — provider implementations
- `jcode-provider-metadata` — model catalog and capabilities
- `jcode-tool-core` — `Tool` trait, `ToolContext`, `ToolExecutionMode`
- `jcode-agent-runtime` — `InterruptSignal`, `SoftInterruptMessage`, `StreamError`, `GracefulShutdownSignal`
- `jcode-storage` — session persistence layer
- `jcode-compaction-core` — context window compaction
- `jcode-embedding` — local ONNX/tokenizer embeddings (feature-gated)
- `jcode-pdf` — PDF parsing (feature-gated)
- `jcode-import-core` — session import
- `jcode-overnight-core` / `jcode-update-core` — background tasks, auto-update
- `jcode-azure-auth` / `jcode-notify-email` — auth and notification integrations
- `jcode-terminal-launch` — terminal emulator launching
- `jcode-terminal-image` — terminal image rendering
- `jcode-build-support` — build-time code generation
- `jcode-build-meta` — build metadata
- `jcode-logging` — logging infrastructure
- `jcode-productivity-core` — productivity features
- `jcode-render-core` — rendering core
- `jcode-app-core` — non-presentation application logic
- `jcode-base` — lowest-level cross-cutting helpers

**TUI crates** (`jcode-tui-*`):
- `jcode-tui` — main TUI crate (presentation layer)
- `jcode-tui-core` — shared TUI primitives
- `jcode-tui-render` — frame rendering
- `jcode-tui-messages` — message display
- `jcode-tui-markdown` — markdown rendering
- `jcode-tui-mermaid` — mermaid diagram rendering
- `jcode-tui-tool-display` — tool execution output
- `jcode-tui-session-picker` — session list/selector
- `jcode-tui-account-picker` — provider account picker
- `jcode-tui-usage-overlay` — usage/cost overlay
- `jcode-tui-workspace` — workspace sidebar
- `jcode-tui-style` — theme and color definitions
- `jcode-tui-anim` — TUI animations

**Other**:
- `jcode-mobile-core` / `jcode-mobile-sim` — iOS/mobile support
- `jcode-desktop` — separate wgpu/winit native desktop experiment (**not** the Tauri app)

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | Main binary + library: agent, server, session, provider, tool, tui, config, memory, safety, etc. |
| `crates/` | 60+ workspace crates organized by domain |
| `jcode-app/` | Tauri v2 desktop app (React 19 + TypeScript + Tailwind v4) |
| `tests/` | Integration/e2e test harness with mock provider |
| `scripts/` | Build helpers, test runners, budget ratchets, benchmarks, release automation |
| `docs/` | Architecture docs, RFCs, design decisions |
| `ios/` | XcodeGen-based iOS app |
| `telemetry-worker/` | Cloudflare Workers telemetry service |
| `.github/workflows/` | CI (`ci.yml`), release (`release.yml`), Windows smoke (`windows-smoke.yml`) |

## Development Commands

### Fast Iteration (preferred)

```bash
cargo check                                    # check only (no link)
cargo check --all-targets --all-features       # CI gate
scripts/dev_cargo.sh build                     # dev build with auto-configured linker/cache
```

`scripts/dev_cargo.sh` auto-detects sccache and fast linkers (lld/mold + clang). Control via `JCODE_DEV_FEATURE_PROFILE` (`default`, `minimal`, `pdf`, `embeddings`, `full`).

### Build & Install

```bash
scripts/install_release.sh           # self-dev install (symlinks to ~/.jcode/builds/current/)
scripts/install_release.sh --fast    # fast self-dev install (no LTO)
scripts/remote_build.sh --release    # offload to remote machine via SSH + rsync
```

### Testing

```bash
scripts/test_fast.sh                 # lib + bins + startup budget check
cargo test -p <crate-name>           # single crate
cargo test <test_name> -- --nocapture # specific test
cargo test --test e2e                # e2e integration tests
cargo test --test provider_matrix    # provider matrix tests
cargo test -p jcode-mobile-core -p jcode-mobile-sim  # mobile tests
scripts/test_e2e.sh                  # full suite including e2e
```

Optional real-provider tests (require API keys):
```bash
JCODE_REAL_PROVIDER=1 scripts/real_provider_smoke.sh
JCODE_REAL_AUTH_TEST=1 scripts/test_auth_e2e.sh
```

### Quality Gates (run before pushing)

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
scripts/check_warning_budget.sh
python3 scripts/check_code_size_budget.py
python3 scripts/check_test_size_budget.py
python3 scripts/check_panic_budget.py
python3 scripts/check_swallowed_error_budget.py
```

There is no `rustfmt.toml` or `clippy.toml` — Rust defaults apply.

### Tauri Desktop App (`jcode-app/`)

Run from inside `jcode-app/`:
```bash
pnpm tauri dev           # full Tauri dev (Rust + Vite)
pnpm dev                 # frontend only (port 1420)
pnpm build               # frontend production build
```

Rust backend commands from repo root:
```bash
cargo check
cargo build -p jcode-app
pnpm tauri build          # from inside jcode-app/
```

## Code Conventions & Common Patterns

### Error Handling

- **Application code** (`src/`): uses `anyhow::Result` pervasively
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

## Feature Flags

| Flag | Purpose |
|------|---------|
| `default = ["pdf", "embeddings"]` | PDF parsing + local embeddings ON by default |
| `embeddings` | Heavy ONNX/tokenizer stack (~163 extra crates). Opt-in via `JCODE_DEV_FEATURE_PROFILE=full` |
| `pdf` | PDF parsing via `jcode-pdf` crate |
| `dev-bins` | Extra dev binaries (session_memory_bench, mermaid_side_panel_probe, tui_bench) |
| `jemalloc` | jemalloc allocator with stats |
| `jemalloc-prof` | jemalloc with profiling support |
| `mmdr-size-api` | Mermaid diagram size API |

## Build Profiles

| Profile | Opt-level | LTO | Codegen Units | Use |
|---------|-----------|-----|---------------|-----|
| `dev` | 0 | off | 256 | Fast compilation during development |
| `test` | 0 | off | 256 | Test builds |
| `release` | 1 | off | 256 | Fast release (not for distribution) |
| `release-lto` | 3 | thin | 16 | Distribution builds, CI releases |
| `selfdev` | 0 | off | 256 | Self-dev install path (inherits release) |

- `cargo build --release` — Fast release. **Not** the distribution build.
- `cargo build --profile release-lto` — True release. Used by `install_release.sh` and CI.
- `jcode-tui-anim` is pinned to `opt-level = 3` in dev/test/selfdev profiles (trig-heavy 3D samplers that otherwise dominate idle CPU).

## Important Files

- `src/main.rs` — entry point, global allocator (jemalloc), tokio runtime bootstrap
- `src/lib.rs` — module declarations, `run()` entry point, session ID global
- `Cargo.toml` — workspace definition, all members, dependencies, feature flags, profiles
- `crates/jcode-protocol/src/lib.rs` — `ServerEvent` enum (central communication type)
- `crates/jcode-provider-core/src/lib.rs` — `Provider` trait, `EventStream` type
- `crates/jcode-tool-core/src/lib.rs` — `Tool` trait, `ToolContext`
- `crates/jcode-agent-runtime/src/lib.rs` — `InterruptSignal`, `SoftInterruptMessage`, `StreamError`
- `crates/jcode-session-types/src/lib.rs` — session state types
- `crates/jcode-message-types/src/lib.rs` — `Message`, `StreamEvent`, `ContentBlock`
- `jcode-app/src-tauri/src/lib.rs` — 50+ `#[tauri::command]` handlers
- `jcode-app/src/hooks/useJcodeSession.ts` — frontend state management (useReducer)
- `docs/SERVER_ARCHITECTURE.md` — server design and lifecycle

## Testing & QA

### Test Structure
- **Inline tests**: `#[cfg(test)] mod tests` at bottom of most `src/` modules
- **Integration tests**: `tests/e2e/` with mock provider (`tests/e2e/mock_provider.rs`) for deterministic testing
- **Test support**: `tests/e2e/test_support/` provides `TestEnvGuard`, `EnvVarGuard`, mock transport
- **Provider matrix**: `tests/provider_matrix.rs` — tests across provider implementations
- **Auth tests**: `tests/auth_login_flow.rs` — OAuth/device auth flow tests
- **Mobile**: tests in `crates/jcode-mobile-core/tests/`

### Test Patterns
- `#[tokio::test]` for async tests
- Mock provider returns pre-scripted `StreamEvent` sequences
- Environment variable guards for isolation
- No external mocks (mockall, etc.) observed — manual test doubles preferred

### Quality Budget System
The project enforces quality via ratcheting budgets (can only improve, never regress):
- **Code size**: files over 1200 lines tracked in `code_size_budget.json`
- **Warning budget**: compiler warnings counted, must not increase
- **Panic budget**: grep for panic! / unreachable! / unwrap patterns
- **Swallowed error budget**: grep for `let _ =` patterns on Results
- **Test size budget**: large test files tracked

Run `--update` flag on budget scripts after intentional cleanup to reset baselines.

## Runtime/Tooling Preferences

- **Rust edition**: 2024
- **Package manager**: Cargo (Rust), pnpm (frontend)
- **Node runtime**: Bun detected in some scripts; Node.js for others
- **CI**: GitHub Actions — `ci.yml` (build+test+lint all platforms), `release.yml` (multi-platform builds), `windows-smoke.yml`
- **Linker**: prefers lld or mold via `scripts/dev_cargo.sh`; set `JCODE_FAST_LINKER=system` to disable
- **Cache**: sccache auto-detected and enabled by dev_cargo.sh
- **Logs**: `~/.jcode/logs/jcode-YYYY-MM-DD.log`
- **Install paths**: `~/.local/bin/jcode` (launcher symlink), `~/.jcode/builds/current/` (self-dev), `~/.jcode/builds/stable/` (release)

## Git Dependencies

The workspace depends on `agentgrep` via `git@github.com:1jehuang/agentgrep.git` (tag `v0.1.2`). CI requires `secrets.DEPLOY_KEY`. Local builds work with SSH key access.

## Release Process

- Tag format: `v*`
- `release.yml` builds Linux (x86_64, aarch64), macOS (x86_64, aarch64), Windows (x86_64, aarch64)
- GitHub release with SHA256SUMS
- Homebrew formula and AUR package auto-updated
- Windows ARM64: `--no-default-features --features pdf` (ring/cargo-xwin limitation)

## Architecture Docs

- `docs/SERVER_ARCHITECTURE.md` — single-server, multi-client design
- `docs/SWARM_ARCHITECTURE.md` — multi-agent swarm coordination
- `docs/MEMORY_ARCHITECTURE.md` — persistent memory graph system
- `docs/AMBIENT_MODE.md` — background/ambient agent mode
- `docs/SAFETY_SYSTEM.md` — permission gating and safety
- `docs/DESKTOP_APP_ARCHITECTURE.md` — Tauri desktop app design
- `docs/IOS_CLIENT.md` — iOS client architecture
- `docs/MODULAR_ARCHITECTURE_RFC.md` — crate modularization RFC
- `docs/CRATE_OWNERSHIP_BOUNDARIES.md` — crate dependency rules
- `docs/CODE_QUALITY_TODO.md` — tracked quality improvements
