# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**jcode** is a high-performance coding agent built in Rust. It supports interactive TUI use, non-interactive runs, persistent server/client workflows, and a Tauri v2 desktop app. The repo is a Rust workspace with 60+ crates.

Key surfaces:
- **TUI** (`src/main.rs` → `jcode::run()`) — terminal UI using ratatui
- **Server** (`jcode serve`) — Unix socket server for multi-client sessions
- **Desktop** (`jcode-app/`) — Tauri v2 + React 19 + TypeScript. See `jcode-app/CLAUDE.md` for Tauri-specific guidance
- **iOS** (`ios/`) — XcodeGen-based iOS app
- **Telemetry** (`telemetry-worker/`) — Cloudflare Workers service

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

Release profiles:
- `cargo build --release` — Fast release (opt-level 1, incremental, 256 codegen units). **Not** the distribution build.
- `cargo build --profile release-lto` — True release (thin LTO, 16 codegen units). Used by `install_release.sh` and CI.
- `scripts/build_linux_compat.sh dist` — Portable Linux x86_64 release in CentOS 7 container.

## Feature Flags

- `default = ["pdf"]` — PDF parsing on by default.
- `embeddings` — Heavy local ONNX/tokenizer stack (~163 extra crates, slow compile). **Opt-in only** via `--features embeddings` or `JCODE_DEV_FEATURE_PROFILE=full`.
- `dev-bins` — Extra dev binaries (`session_memory_bench`, `mermaid_side_panel_probe`, `tui_bench`).
- `jemalloc` / `jemalloc-prof` — Memory allocator and profiling.

`scripts/dev_cargo.sh` is the preferred build wrapper on Linux x86_64. It auto-detects sccache and fast linkers (lld/mold + clang). Set `JCODE_DEV_FEATURE_PROFILE` to `default`, `minimal`, `pdf`, `embeddings`, or `full`.

## Test Commands

```bash
# Fast loop (lib + bins + startup budget check)
scripts/test_fast.sh

# Single crate
cargo test -p <crate-name>

# Specific test
cargo test <test_name> -- --nocapture

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
```

There is no `rustfmt.toml` or `clippy.toml` — defaults apply.

## Workspace Architecture

### Crate Organization

The workspace is organized by domain. Key crates:

| Crate | Purpose |
|-------|---------|
| `jcode` (root) | Main binary, lib, agent orchestration |
| `jcode-agent-runtime` | Agent runtime primitives (signals, interrupts, streaming) |
| `jcode-protocol` | Server/client event protocol (`ServerEvent`, etc.) |
| `jcode-provider-core` | Provider abstraction trait and runtime |
| `jcode-provider-openai` / `-gemini` / `-openrouter` | Provider implementations |
| `jcode-provider-metadata` | Model catalog and metadata |
| `jcode-core` | Shared core types and utilities |
| `jcode-session-types` / `jcode-message-types` | Session and message type definitions |
| `jcode-tool-core` / `jcode-tool-types` | Tool system trait and types |
| `jcode-memory-types` / `jcode-swarm-core` | Memory and swarm coordination |
| `jcode-tui-*` | TUI component crates (markdown, messages, tool display, etc.) |
| `jcode-storage` | Session persistence |
| `jcode-plan` | Planning system |
| `jcode-compaction-core` | Context compaction |

### Agent Architecture (`src/agent.rs` and submodules)

The agent is the core orchestrator. Key submodules:
- `turn_execution.rs` / `turn_loops.rs` — Main turn loop
- `streaming.rs` / `turn_streaming_broadcast.rs` / `turn_streaming_mpsc.rs` — Event streaming
- `tools.rs` — Tool execution and result handling
- `provider.rs` — Provider interaction within the agent
- `messages.rs` — Message building and history management
- `prompting.rs` — Prompt construction
- `status.rs` — Agent status tracking

The agent uses `jcode_agent_runtime` for cross-cutting concerns like graceful shutdown, soft interrupts, and stream error handling.

### Server Architecture (`src/server.rs`)

Single-server, multi-client over Unix sockets. See `docs/SERVER_ARCHITECTURE.md`.
- Server named with adjective+animal (e.g., "🔥 blazing 🦊 fox")
- Registry at `~/.jcode/servers.json`
- MCP pool shared across sessions
- Supports transparent reconnect after server reload (`/reload` execs new binary)

### Communication Flow

**TUI mode**: Direct in-process — `jcode::run()` creates agent + session.

**Server mode**: Client ↔ Unix socket ↔ `Server` ↔ `Session` ↔ `Agent`.

**Desktop mode** (Tauri): Frontend `invoke()` → Tauri command → `jcode::Agent` → Tauri events (`server-event`) → frontend listener. See `jcode-app/CLAUDE.md` for details.

### State Flow

1. `Session` (in `src/session.rs`) owns conversation history, git state, and metadata
2. `Agent` drives the turn loop, calling the provider and tools
3. `ServerEvent`s flow out via `protocol` to clients
4. `ToolContext` gives tools access to filesystem, process execution, and session state

## Key Files

- `src/lib.rs` — Module declarations and feature-gated modules
- `src/main.rs` — Entry point with allocator config and tokio runtime
- `src/agent.rs` — Agent module root, re-exports from `jcode_agent_runtime`
- `src/server.rs` — Server implementation
- `src/session.rs` — Session management
- `src/protocol.rs` — Event protocol definitions
- `src/provider.rs` — Provider trait and implementations
- `src/tool.rs` — Tool trait and registry
- `src/config.rs` — Configuration system
- `src/memory*.rs` — Memory graph and extraction
- `src/safety.rs` — Safety system
- `src/side_panel.rs` — Side panel content
- `Cargo.toml` — Workspace definition, feature flags, profiles

## Important Notes

- `scripts/dev_cargo.sh --print-setup` shows active linker/cache configuration.
- Git dependency on `agentgrep` via SSH (`git@github.com:1jehuang/agentgrep.git`). CI needs `secrets.DEPLOY_KEY`.
- Logs: `~/.jcode/logs/jcode-YYYY-MM-DD.log`
- Install paths: `~/.local/bin/jcode` (launcher), `~/.jcode/builds/current/` (self-dev), `~/.jcode/builds/stable/` (release).
- Windows ARM64 builds use `--no-default-features --features pdf` due to upstream `ring`/`cargo-xwin` limitations.
- The `crates/jcode-desktop/` directory is a separate wgpu/winit native desktop experiment. The actual desktop app is `jcode-app/` (Tauri).

## References

- `jcode-app/CLAUDE.md` — Tauri desktop app guidance
- `AGENTS.md` — Full repo guidelines (build, test, release, iOS, etc.)
- `docs/SERVER_ARCHITECTURE.md` — Server design
- `docs/SWARM_ARCHITECTURE.md` — Swarm coordination
- `docs/MEMORY_ARCHITECTURE.md` — Memory system
- `docs/AMBIENT_MODE.md` — Ambient mode / OpenClaw
- `docs/SAFETY_SYSTEM.md` — Safety system
