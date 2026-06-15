# Repository Guidelines

## Project Overview

**jcode** is a high-performance multi-model AI coding agent written in Rust. It supports:

- **Interactive TUI** (`ratatui` + `crossterm`) — primary interface
- **Server/Client mode** — single-server, multi-client over Unix sockets (and named pipes on Windows)
- **Desktop app** (`jcode-app/`) — Tauri v2 + React 19 + TypeScript + Tailwind CSS v4
- **iOS app** (`ios/`) — XcodeGen-based
- **Telemetry service** (`telemetry-worker/`) — Cloudflare Workers + D1

The codebase is a Rust workspace with ~65 crates under `crates/` plus the main binary/lib in `src/`.

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

### Crate Layering

```
┌─────────────────────────────────────┐
│  Root crate: jcode (src/)           │
│  main.rs + lib.rs + cli/            │
│  Re-exports: pub use jcode_tui::*   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  jcode-tui (TUI presentation)       │
│  Re-exports: pub use jcode_app_core::*
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  jcode-app-core (application core)  │
│  agent/, server/, tool/, ambient/,  │
│  notifications, external_auth, ...  │
│  Re-exports: pub use jcode_base::*  │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  jcode-base (foundation layer)      │
│  provider/, auth/, config/, session/│
│  safety, compaction, memory, bus, ...│
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  Type / trait crates (~50)          │
│  jcode-provider-core, jcode-tool-   │
│  core, jcode-agent-runtime,         │
│  jcode-protocol, jcode-*-types, ... │
└─────────────────────────────────────┘
```

The root `jcode` crate (`src/lib.rs`, `src/main.rs`) is a thin entrypoint. `pub use jcode_tui::*` keeps historical `crate::<module>` paths resolving from the root crate. When exploring, the real sources are:

- `crates/jcode-tui/src/` — TUI rendering, info widgets, app shell
- `crates/jcode-app-core/src/` — `agent/`, `server/`, `session*`, `protocol*`, `provider.rs`, `tool/`, `config/`, `memory*`, `safety`, `compaction`, `ambient/`, `overnight`, `notifications`, `external_auth`, etc.
- `crates/jcode-base/src/` — `config/`, `auth`, `browser`, `compaction`, `embedding`, `gateway`, `id`, `notifications`, `tool` (lowest layer)

> **Note:** `crates/jcode-desktop/` is a separate `wgpu`/`winit` native desktop experiment — **not** the shipping desktop app. The shipping desktop app is `jcode-app/` (Tauri).

### Communication Modes

| Mode | Flow |
|------|------|
| **TUI** | `jcode::run()` → Agent → Session (in-process) |
| **Server** | Client ↔ Unix socket ↔ Server ↔ Session ↔ Agent |
| **Desktop** | Frontend `invoke()` → Tauri command → Agent → `server-event` → Frontend listener |

### Key Architectural Layers

1. **`Agent`** — orchestrates turn loops: sends messages to provider, dispatches tool calls, builds prompts. Lives in `crates/jcode-app-core/src/agent/`.
2. **`Provider`** — `async_trait Provider` in `jcode-provider-core`. Implementations: OpenAI, Gemini, OpenRouter, AWS Bedrock, Anthropic, Copilot, Cursor, Antigravity. Returns `EventStream` (pinned `Stream<Item = Result<StreamEvent>>`). MultiProvider in `jcode-base/src/provider/mod.rs` handles switching, failover, catalog refresh.
3. **`Tool`** — `async_trait Tool` in `jcode-tool-core`. Each tool gets a `ToolContext` (session_id, working_dir, interrupt signals). 37+ base tools: bash, file ops, git, web search, browser, memory, communicate/swarm, batch, MCP, selfdev, etc.
4. **`Session`** — owns conversation history, git state, model selection, memory config. Persisted via journal (snapshot + append-only log) in `jcode-base/src/session/persistence.rs`.
5. **`Protocol`** — `Request` / `ServerEvent` enums in `jcode-protocol` — newline-delimited JSON over Unix socket. 40+ request variants, 30+ server events.
6. **`Server`** — named with adjective+animal (e.g. "blazing fox"), registry at `~/.jcode/servers.json`, transparent reconnect on `/reload`.

### Dependency Inversion Patterns

The codebase repeatedly uses a "register callback to invert edge" pattern in `src/cli/startup.rs`:

- `safety::register_permission_notifier()` — safety doesn't depend on notifications
- `config::on_config_reloaded(...)` — config doesn't depend on auth
- `memory::register_synthetic_entry_provider()` — memory doesn't depend on skills
- `server_spawn::register_default_server_spawner()` — server doesn't depend on CLI
- `session_list_cache::register_invalidator(...)` — server doesn't depend on TUI

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | Main binary + library: CLI args, dispatch, startup, re-exports |
| `crates/` | ~65 workspace crates organized by domain |
| `jcode-app/` | Tauri v2 desktop app (React 19 + TypeScript + Tailwind v4) |
| `tests/` | Integration/e2e test harness with mock provider |
| `scripts/` | Build helpers, test runners, budget ratchets, benchmarks, release automation |
| `docs/` | Architecture docs, RFCs, design decisions |
| `ios/` | XcodeGen-based iOS app |
| `telemetry-worker/` | Cloudflare Workers telemetry service |
| `.github/workflows/` | CI (`ci.yml`), release (`release.yml`), Windows smoke (`windows-smoke.yml`) |

### Crate Organization

**Core abstractions** (types only, no logic):
- `jcode-core` — shared utilities (env, fs, id generation, panic helpers)
- `jcode-session-types`, `jcode-message-types`, `jcode-tool-types`, `jcode-config-types`
- `jcode-protocol` — `Request` / `ServerEvent`
- `jcode-memory-types`, `jcode-swarm-core`, `jcode-plan`
- `jcode-task-types`, `jcode-batch-types`, `jcode-background-types`, `jcode-ambient-types`, `jcode-selfdev-types`, `jcode-usage-types`, `jcode-gateway-types`, `jcode-auth-types`, `jcode-side-panel-types`

**Behavior crates**:
- `jcode-provider-core` — `Provider` trait
- `jcode-provider-openai`, `-gemini`, `-openrouter`, etc. — provider implementations
- `jcode-provider-metadata`, `jcode-provider-env` — catalog and env resolution
- `jcode-tool-core` — `Tool` trait, `ToolContext`
- `jcode-agent-runtime` — `InterruptSignal`, `SoftInterruptMessage`, `StreamError`
- `jcode-storage` — session persistence layer
- `jcode-compaction-core` — context window compaction
- `jcode-embedding` — local ONNX/tokenizer embeddings (feature-gated)
- `jcode-pdf` — PDF parsing (feature-gated)
- `jcode-app-core` — non-presentation application logic
- `jcode-base` — lowest-level cross-cutting helpers

**TUI crates** (`jcode-tui-*`):
- `jcode-tui` — main TUI crate
- `jcode-tui-core`, `jcode-tui-render`, `jcode-tui-messages`, `jcode-tui-markdown`, `jcode-tui-mermaid`, `jcode-tui-tool-display`, `jcode-tui-session-picker`, etc.

## Development Commands

### Fast Iteration (preferred)

```bash
cargo check                                    # check only (no link)
cargo check --all-targets --all-features       # CI gate
scripts/dev_cargo.sh build                     # dev build with auto-configured linker/cache
```

`scripts/dev_cargo.sh` auto-detects `sccache` and fast linkers (`lld`/`mold` + `clang`). Control features via `JCODE_DEV_FEATURE_PROFILE` (`default`, `minimal`, `pdf`, `embeddings`, `full`).

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
pnpm tauri build         # production Tauri build
```

Rust backend commands from repo root:

```bash
cargo check
cargo build -p jcode-app
cargo test -p jcode-app
```

## Code Conventions & Common Patterns

### Error Handling

- **Application code** (`src/`, `crates/jcode-app-core/`): uses `anyhow::Result` pervasively
- **Library crates**: use `thiserror` for structured error types (e.g., `StreamError` in `jcode-agent-runtime`)
- **Panics**: rare; budget-enforced via `scripts/check_panic_budget.py`
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

## Important Files

- `src/main.rs` — entry point, global allocator (jemalloc), tokio runtime bootstrap
- `src/lib.rs` — module declarations, `run()` entry point, session ID global
- `src/cli/startup.rs` — startup orchestration, dependency inversion callbacks
- `src/cli/dispatch.rs` — command dispatcher
- `src/cli/args.rs` — clap CLI argument definitions
- `Cargo.toml` — workspace definition, all members, dependencies, feature flags, profiles
- `crates/jcode-protocol/src/lib.rs` / `wire.rs` — `Request` and `ServerEvent`
- `crates/jcode-provider-core/src/lib.rs` — `Provider` trait, `EventStream`
- `crates/jcode-tool-core/src/lib.rs` — `Tool` trait, `ToolContext`
- `crates/jcode-agent-runtime/src/lib.rs` — `InterruptSignal`, `SoftInterruptMessage`, `StreamError`
- `crates/jcode-base/src/config.rs` — hot-reloadable config
- `crates/jcode-base/src/session.rs` — session model
- `crates/jcode-base/src/session/persistence.rs` — journal-based persistence
- `crates/jcode-app-core/src/agent/turn_loops.rs` — main agent turn loop
- `crates/jcode-app-core/src/server/client_lifecycle.rs` — client-server request handling
- `crates/jcode-app-core/src/tool/mod.rs` — tool registry
- `jcode-app/src-tauri/src/lib.rs` — Tauri commands and event streaming
- `docs/SERVER_ARCHITECTURE.md` — server design and lifecycle
- `docs/SWARM_ARCHITECTURE.md` — multi-agent swarm coordination
- `docs/MEMORY_ARCHITECTURE.md` — persistent memory graph system
- `docs/AMBIENT_MODE.md` — background/ambient agent mode
- `docs/SAFETY_SYSTEM.md` — permission gating and safety

## Runtime/Tooling Preferences

| Tool | Version / Choice |
|------|-----------------|
| Rust edition | 2024 |
| Package manager | Cargo (Rust), pnpm (frontend) |
| Node runtime | Bun detected in some scripts; Node.js for others |
| Frontend bundler | Vite 7 |
| React | 19 (StrictMode) |
| TypeScript | 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) |
| Tailwind | v4 via `@tailwindcss/vite` |
| UI library | shadcn/ui (base-nova) on `@base-ui/react` |
| Icons | `lucide-react` |
| Backend | Tauri v2 (Rust 2021) |
| CI | GitHub Actions — `ci.yml`, `release.yml`, `windows-smoke.yml` |
| Linker | prefers `lld` or `mold` via `scripts/dev_cargo.sh`; set `JCODE_FAST_LINKER=system` to disable |
| Cache | sccache auto-detected and enabled by `dev_cargo.sh` |
| Logs | `~/.jcode/logs/jcode-YYYY-MM-DD.log` |
| Install paths | `~/.local/bin/jcode` (launcher symlink), `~/.jcode/builds/current/` (self-dev), `~/.jcode/builds/stable/` (release) |

### Path Aliases (jcode-app)

- `@/*` → `./src/*` (Vite `resolve.alias` + TS `paths`)

### Feature Flags

| Flag | Purpose |
|------|---------|
| `default = ["pdf", "embeddings"]` | PDF parsing + local embeddings ON by default |
| `embeddings` | Heavy ONNX/tokenizer stack (~163 extra crates). Opt-in via `JCODE_DEV_FEATURE_PROFILE=full` |
| `pdf` | PDF parsing via `jcode-pdf` crate |
| `dev-bins` | Extra dev binaries |
| `jemalloc` | jemalloc allocator with stats |
| `jemalloc-prof` | jemalloc with profiling support |
| `mmdr-size-api` | Mermaid diagram size API |

### Build Profiles

| Profile | Opt-level | LTO | Codegen Units | Use |
|---------|-----------|-----|---------------|-----|
| `dev` | 0 | off | 256 | Fast compilation |
| `test` | 0 | off | 256 | Test builds |
| `release` | 1 | off | 256 | Fast release (not for distribution) |
| `release-lto` | 3 | thin | 16 | Distribution builds, CI releases |
| `selfdev` | 0 | off | 256 | Self-dev install path |

## Testing & QA

### Test Structure

- **Inline tests**: `#[cfg(test)] mod tests` at bottom of most `src/` modules
- **Integration tests**: `tests/e2e/` with mock provider (`tests/e2e/mock_provider.rs`) for deterministic testing
- **Test support**: `tests/e2e/test_support/` provides `TestEnvGuard`, `EnvVarGuard`, mock transport, PTY helpers, server lifecycle helpers
- **Provider matrix**: `tests/provider_matrix.rs` — tests across provider implementations
- **Auth tests**: `tests/auth_login_flow.rs` — OAuth/device auth flow tests
- **Mobile**: tests in `crates/jcode-mobile-core/tests/` and `crates/jcode-mobile-core/src/lib_tests.rs`

### Test Patterns

- `#[tokio::test]` for async tests
- Mock provider returns pre-scripted `StreamEvent` sequences
- Environment variable guards for isolation (`JCODE_HOME` temp dirs)
- No external mocks (mockall, etc.) observed — manual test doubles preferred

### Quality Budget System

The project enforces quality via ratcheting budgets (can only improve, never regress):

- **Code size**: files over 1200 lines tracked in `scripts/code_size_budget.json`
- **Warning budget**: compiler warnings counted, must not increase (`scripts/check_warning_budget.sh`)
- **Panic budget**: grep for `panic!` / `unreachable!` / `.unwrap()` / `.expect()` patterns
- **Swallowed error budget**: grep for `let _ =` patterns on Results
- **Test size budget**: large test files tracked
- **Dependency boundaries**: enforced by crate ownership rules

Run `--update` flag on budget scripts after intentional cleanup to reset baselines.
