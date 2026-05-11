# Repository Guidelines

## Project Structure

- **Root workspace**: Rust monorepo with 60+ crates under `crates/`, plus the main `jcode` binary/lib in `src/`.
- **`jcode-app/`**: Tauri v2 desktop app (React 19 + Vite + TypeScript + Tailwind v4). **Not** the same as `crates/jcode-desktop/`, which is a separate wgpu/winit native desktop experiment. See `jcode-app/CLAUDE.md` for Tauri-specific guidance.
- **`telemetry-worker/`**: Cloudflare Workers telemetry service (Wrangler + D1). Migrations run via `npx wrangler d1 execute`.
- **`ios/`**: iOS app built with XcodeGen (`ios/project.yml`), deployed via Codemagic CI to TestFlight.
- **`figma/`**: Figma plugin assets and design specs.
- **`scripts/`**: Build helpers, test runners, budget ratchets, release automation, and benchmarks.

## Development Workflow

- **Commit as you go** — Make small, focused commits after completing each feature or fix.
- **Push when done** — Push all commits to remote when finishing a task or session.
- **Use fast iteration by default** — Prefer `cargo check`, targeted tests, and dev builds while iterating.
- **Rebuild when done** — When you are done making changes, build the source.
- **Bump version for releases** — Update version in `Cargo.toml` when making releases. Determine bump (patch/minor/major) by reviewing changes since the last release.

## Build Commands

### Fast iteration (preferred)
```bash
# Check only (no link)
cargo check

# Check all targets and features (CI gate)
cargo check --all-targets --all-features

# Dev build with auto-configured linker/cache
scripts/dev_cargo.sh build
```

### Full build & install
```bash
# Self-dev install (symlinks into ~/.jcode/builds/current/ and ~/.local/bin/jcode)
scripts/install_release.sh

# Fast self-dev install (no LTO)
scripts/install_release.sh --fast

# Remote build (offload to another machine via SSH + rsync)
scripts/remote_build.sh --release
```

### Release builds
- `cargo build --release` — Fast release profile (opt-level 1, incremental, 256 codegen units). **Not** the final distribution build.
- `cargo build --profile release-lto` — True release profile (thin LTO, 16 codegen units). Used by `scripts/install_release.sh` and CI.
- `scripts/build_linux_compat.sh dist` — Portable Linux x86_64 release built in a CentOS 7 / manylinux2014 container for glibc 2.17 baseline.

### Dev cargo wrapper
`scripts/dev_cargo.sh` is the preferred build wrapper on Linux x86_64. It auto-detects and enables:
- **sccache** if available
- **Fast linker** (`lld` or `mold` + `clang`) unless `JCODE_FAST_LINKER=system`
- **Feature profile** via `JCODE_DEV_FEATURE_PROFILE`:
  - `default` (current default, includes `pdf`)
  - `minimal` / `none` (`--no-default-features`)
  - `pdf` (`--no-default-features --features pdf`)
  - `embeddings` (`--no-default-features --features embeddings`)
  - `full` (`--features embeddings,pdf`)

Run `scripts/dev_cargo.sh --print-setup` to see active configuration.

## Feature Flags

- `default = ["pdf"]` — PDF parsing is on by default.
- `embeddings` — Heavy local ONNX/tokenizer embedding stack (~163 extra crates, slow compile). **Opt-in only** via `--features embeddings` or `JCODE_DEV_FEATURE_PROFILE=full`.
- `dev-bins` — Enables extra development binaries (`session_memory_bench`, `mermaid_side_panel_probe`, `tui_bench`).
- `jemalloc` / `jemalloc-prof` — Memory allocator and profiling.

## Testing

### Fast test loop
```bash
scripts/test_fast.sh          # lib + bins + startup budget check
```

### Focused verification
```bash
# Single crate
cargo test -p <crate-name>

# Specific test
cargo test <test_name> -- --nocapture

# Integration tests
cargo test --test e2e
cargo test --test provider_matrix

# Mobile tests
cargo test -p jcode-mobile-core -p jcode-mobile-sim
```

### Full validation
```bash
scripts/test_e2e.sh           # Full suite including e2e tests
```

### Optional real-provider tests
```bash
JCODE_REAL_PROVIDER=1 scripts/real_provider_smoke.sh
JCODE_REAL_AUTH_TEST=1 scripts/test_auth_e2e.sh
```

## Quality Gates

CI enforces these. Run them locally before pushing:
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

## Tauri Desktop App (`jcode-app/`)

- Run from inside `jcode-app/`:
  - `pnpm tauri dev` — Full Tauri dev mode (Rust backend + Vite frontend)
  - `pnpm dev` — Frontend only (port 1420)
  - `pnpm build` — Frontend production build
- Rust backend commands run from the **repo root** (`../..`):
  - `cargo check`
  - `cargo build -p jcode-app`
  - `pnpm tauri build` (from inside `jcode-app/`)
- No tests in `jcode-app/` itself; tests are in the parent Rust workspace.

## iOS App

- Generate Xcode project: `cd ios && xcodegen generate`
- CI/CD: Codemagic (`codemagic.yaml`) builds and deploys to TestFlight on push to `master` when `ios/**` or `codemagic.yaml` changes.

## Logs & Debugging

- Logs: `~/.jcode/logs/jcode-YYYY-MM-DD.log`
- Debug socket: Available for runtime-level debugging.

## Install Paths

- `~/.local/bin/jcode` — Launcher symlink (ensure this is **before** `~/.cargo/bin` in `PATH`).
- `~/.jcode/builds/current/jcode` — Active local/source-build channel (self-dev builds and `scripts/install_release.sh` point here).
- `~/.jcode/builds/stable/jcode` — Stable release channel (`scripts/install.sh` installs this).
- `~/.jcode/builds/versions/<version>/jcode` — Immutable versioned binaries.
- On Windows: `%LOCALAPPDATA%\jcode\bin\jcode.exe` (launcher), `%LOCALAPPDATA%\jcode\builds\stable\jcode.exe` (stable).

## Git Dependencies

The workspace depends on `agentgrep` via SSH (`git@github.com:1jehuang/agentgrep.git`). CI requires `secrets.DEPLOY_KEY` to clone it. Local builds work if your SSH key has access.

## Docs & Architecture

High-level architecture docs live in `docs/`:
- `docs/SERVER_ARCHITECTURE.md`
- `docs/SWARM_ARCHITECTURE.md`
- `docs/MEMORY_ARCHITECTURE.md`
- `docs/AMBIENT_MODE.md`
- `docs/SAFETY_SYSTEM.md`
- `docs/IOS_CLIENT.md`
- `docs/WINDOWS.md`

## Release Process

- Tag format: `v*`
- `.github/workflows/release.yml` builds for Linux (x86_64, aarch64), macOS (x86_64, aarch64), and Windows (x86_64, aarch64), then creates a GitHub release with SHA256SUMS.
- Homebrew formula and AUR package are auto-updated on release.
- Windows ARM64 builds use `--no-default-features --features pdf` due to upstream ring/cargo-xwin limitations.
