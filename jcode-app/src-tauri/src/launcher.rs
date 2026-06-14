use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// Summary of a macOS application for the launcher UI.
///
/// Application discovery uses the `applications` crate (v0.3.1), which
/// queries LaunchServices / `mdfind` to produce a comprehensive list of
/// installed `.app` bundles — including those in `~/Applications`,
/// `/System/Applications`, and `/System/Library/CoreServices`. For each
/// discovered bundle we optionally read `Contents/Info.plist` to extract
/// the bundle identifier and version string (fields the `applications`
/// crate does not surface).
///
/// `rename_all = "camelCase"` keeps the wire format in sync with the
/// TypeScript `AppInfo` interface in `src/lib/launcherTypes.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub bundle_id: Option<String>,
    pub icon_path: Option<String>,
    /// Path to the `.app` bundle (e.g. `/Applications/Foo.app`).
    pub app_path: String,
    /// Path to the executable inside the bundle, if known.
    pub executable_path: Option<String>,
    /// Best-effort version string (`CFBundleShortVersionString` then
    /// `CFBundleVersion`). Useful for the launcher's secondary text line.
    pub version: Option<String>,
    /// PNG icon encoded as base64 data URL. Extracted from the app
    /// bundle's `.icns` file at scan time.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon_base64: Option<String>,
    /// True when the app is currently running. Populated at search time by
    /// combining the static `AppIndex` with the live `running_apps` set.
    #[serde(default)]
    pub running: bool,
}

// ——— AppIndex (in-memory application catalogue) —————————————————————————

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppIndex {
    apps: Vec<AppInfo>,
}

/// Score how well `query` matches `name` using a simple fuzzy algorithm.
///
/// Returns a positive score when every query character appears in `name`
/// in order, and `0` otherwise. Bonuses are given for matches at the
/// start of the string, after word separators, and for consecutive
/// characters; gaps between matched characters are penalized.
pub fn fuzzy_score(name: &str, query: &str) -> i32 {
    if query.is_empty() {
        return 1;
    }

    let name_lower = name.to_lowercase();
    let query_lower = query.to_lowercase();
    let name_chars: Vec<char> = name_lower.chars().collect();

    let mut score = 0;
    let mut name_idx = 0;
    let mut prev_idx: Option<usize> = None;

    for q in query_lower.chars() {
        let slice = &name_chars[name_idx..];
        let pos = match slice.iter().position(|&c| c == q) {
            Some(p) => p,
            None => return 0,
        };
        let idx = name_idx + pos;

        score += 10;
        if prev_idx.map_or(false, |p| p + 1 == idx) {
            score += 7; // consecutive match
        }
        if idx == 0 {
            score += 8; // start of string
        } else if is_fuzzy_word_start(name_chars[idx - 1]) {
            score += 5; // start of a word
        }
        if let Some(p) = prev_idx {
            let gap = idx - p;
            if gap > 1 {
                score -= ((gap - 1) as i32) * 3; // gap penalty
            }
        }

        name_idx = idx + 1;
        prev_idx = Some(idx);
    }

    score.max(1)
}

fn is_fuzzy_word_start(c: char) -> bool {
    !c.is_alphanumeric()
}
impl AppIndex {
    /// Re-scan the system for installed applications using the
    /// `applications` crate (LaunchServices + Spotlight).
    pub fn refresh(&mut self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let apps = std::thread::Builder::new()
                .name("launcher-app-scan".to_string())
                .spawn(scan_applications)
                .map_err(|e| format!("cannot spawn scanner thread: {e}"))?
                .join()
                .map_err(|_| "app scanner thread panicked".to_string())?;
            let mut apps = apps;
            apps.sort_by(|a, b| {
                a.name
                    .to_lowercase()
                    .cmp(&b.name.to_lowercase())
            });
            self.apps = apps;
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.apps = Vec::new();
            Ok(())
        }
    }

    /// Filter and score the index for the given query.
    ///
    /// An empty query returns the first 80 apps sorted alphabetically.
    /// A non-empty query scores each app by name (falling back to the
    /// bundle id), sorts by score descending then name ascending, and
    /// returns the top 50.
    pub fn search(&self, query: &str) -> Vec<AppInfo> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.apps.iter().take(80).cloned().collect();
        }

        let query_lower = trimmed.to_lowercase();
        let mut scored: Vec<(AppInfo, i32)> = self
            .apps
            .iter()
            .filter_map(|app| {
                let score = fuzzy_score(&app.name, &query_lower);
                if score > 0 {
                    return Some((app.clone(), score));
                }
                if let Some(id) = app.bundle_id.as_ref() {
                    let score = fuzzy_score(id, &query_lower);
                    if score > 0 {
                        return Some((app.clone(), score));
                    }
                }
                None
            })
            .collect();

        scored.sort_by(|a, b| {
            b.1.cmp(&a.1)
                .then_with(|| a.0.name.to_lowercase().cmp(&b.0.name.to_lowercase()))
        });

        scored.into_iter().take(50).map(|(app, _)| app).collect()
    }

    /// Like [`search`], but additionally marks each result `running`
    /// when its bundle id appears in the provided set. Running apps are
    /// surfaced first only when the query is empty.
    pub fn search_with_running(
        &self,
        query: &str,
        running: &HashSet<String>,
    ) -> Vec<AppInfo> {
        let mut results = self.search(query);
        for app in &mut results {
            if let Some(id) = app.bundle_id.as_ref() {
                if running.contains(id) {
                    app.running = true;
                }
            }
        }
        if query.trim().is_empty() && !running.is_empty() {
            results.sort_by(|a, b| {
                b.running
                    .cmp(&a.running)
                    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });
        }
        results
    }

    pub fn all(&self) -> &[AppInfo] {
        &self.apps
    }
}


// ——— Application scanning (macOS) —————————————————————————————————————————

#[cfg(target_os = "macos")]
fn scan_applications() -> Vec<AppInfo> {
    use applications::{AppInfo as _, AppTrait, AppInfoContext};
    use applications::common::SearchPath;

    // mdfind (Spotlight) may miss apps on external volumes or directories
    // excluded from indexing. Add explicit search paths as a fallback.
    let extra_paths: Vec<SearchPath> = {
        let mut paths = vec![
            SearchPath::new(PathBuf::from("/Applications"), 2),
            SearchPath::new(PathBuf::from("/System/Applications"), 2),
            SearchPath::new(PathBuf::from("/System/Library/CoreServices"), 3),
            SearchPath::new(PathBuf::from("/Applications/Utilities"), 1),
        ];
        if let Some(home) = dirs::home_dir() {
            paths.push(SearchPath::new(home.join("Applications"), 2));
        }
        paths
    };

    let mut ctx = AppInfoContext::new(extra_paths);

    match ctx.refresh_apps() {
        Ok(()) => {
            eprintln!("[launcher] applications crate refresh ok");
        }
        Err(e) => {
            eprintln!("[launcher] applications crate refresh failed: {e}");
            return Vec::new();
        }
    }

    let raw = ctx.get_all_apps();
    eprintln!("[launcher] applications crate found {} apps", raw.len());

    // Fallback: manually read top-level app directories. mdfind may miss
    // apps on some systems (Spotlight disabled, sandboxed, etc.).
    let fallback_paths = manual_app_dirs();
    let mut all_apps: Vec<applications::App> = raw;
    let existing: HashSet<PathBuf> = all_apps
        .iter()
        .map(|a| a.app_desktop_path.clone())
        .collect();

    for fb in fallback_paths {
        // Only process if this is an .app bundle not already in the list.
        if !fb
            .extension()
            .map(|e| e == "app")
            .unwrap_or(false)
        {
            continue;
        }
        if existing.contains(&fb) {
            continue;
        }
        if let Ok(app) = applications::App::from_path(&fb) {
            all_apps.push(app);
        }
    }

    eprintln!(
        "[launcher] after manual fallback: {} apps total",
        all_apps.len()
    );

    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out: Vec<AppInfo> = Vec::with_capacity(all_apps.len());
    let mut icon_hits: usize = 0;
    let mut icon_misses: usize = 0;

    for app in all_apps {
        let bundle_path = bundle_root_from_crate_app(&app);

        if !seen.insert(bundle_path.clone()) {
            continue;
        }

        let (name, bundle_id, version, executable) =
            read_app_metadata(&app, &bundle_path);

        let icon_path = app
            .icon_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());

        let icon_base64 = extract_icon_base64(&bundle_path);
        if icon_base64.is_some() {
            icon_hits += 1;
        } else {
            icon_misses += 1;
        }

        out.push(AppInfo {
            name,
            bundle_id,
            icon_path,
            app_path: bundle_path.to_string_lossy().to_string(),
            executable_path: executable,
            version,
            icon_base64,
            running: false,
        });
    }

    eprintln!(
        "[launcher] deduped to {} apps, icons: {} hit / {} miss",
        out.len(),
        icon_hits,
        icon_misses
    );
    out
}

/// Derive `.app` bundle root from the `applications` crate's `App`.
/// The crate sets `app_path_exe` to the binary inside `Contents/MacOS/`
/// (e.g. `/Applications/Safari.app/Contents/MacOS/Safari`). We need
/// the `.app` directory itself for plist reading and icon extraction.
#[cfg(target_os = "macos")]
fn bundle_root_from_crate_app(app: &applications::App) -> PathBuf {
    // app_desktop_path is the .app directory on macOS.
    let desktop = &app.app_desktop_path;
    if desktop.exists() {
        return desktop.clone();
    }
    // Fallback: derive from app_path_exe by walking up to .app.
    if let Some(exe) = &app.app_path_exe {
        let s = exe.to_string_lossy();
        if let Some(offset) = s.find(".app/") {
            return PathBuf::from(&s[..offset + 4]);
        }
        return exe.clone();
    }
    PathBuf::from("/Applications/Unknown.app")
}

/// Read `Info.plist` for all metadata fields.
#[cfg(target_os = "macos")]
fn read_app_metadata(
    app: &applications::App,
    bundle_root: &Path,
) -> (String, Option<String>, Option<String>, Option<String>) {
    use std::fs;

    let data = match fs::read(bundle_root.join("Contents/Info.plist")) {
        Ok(d) => d,
        Err(_) => return (app.name.clone(), None, None, None),
    };
    let dict = match plist::from_bytes::<plist::Value>(&data) {
        Ok(plist::Value::Dictionary(d)) => d,
        _ => return (app.name.clone(), None, None, None),
    };

    let name = dict
        .get("CFBundleDisplayName")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string())
        .or_else(|| {
            dict.get("CFBundleName")
                .and_then(|v| v.as_string())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| app.name.clone());

    let bundle_id = dict
        .get("CFBundleIdentifier")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string());

    let version = dict
        .get("CFBundleShortVersionString")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string())
        .or_else(|| {
            dict.get("CFBundleVersion")
                .and_then(|v| v.as_string())
                .map(|s| s.to_string())
        });

    let executable = dict
        .get("CFBundleExecutable")
        .and_then(|v| v.as_string())
        .map(|exe| {
            bundle_root
                .join("Contents/MacOS")
                .join(exe)
                .to_string_lossy()
                .to_string()
        });

    (name, bundle_id, version, executable)
}

/// Walk common app directories manually as a fallback for `mdfind`.
#[cfg(target_os = "macos")]
fn manual_app_dirs() -> Vec<PathBuf> {
    use std::fs;

    let roots: &[&str] = &[
        "/Applications",
        "/System/Applications",
        "/Applications/Utilities",
    ];

    let mut out = Vec::new();
    for root in roots {
        let path = Path::new(root);
        if !path.exists() {
            continue;
        }
        let entries = match fs::read_dir(path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().map(|e| e == "app").unwrap_or(false) {
                out.push(p);
            }
        }
    }

    // Also scan subdirectories of /System/Library/CoreServices
    let cs = Path::new("/System/Library/CoreServices");
    if cs.exists() {
        if let Ok(entries) = fs::read_dir(cs) {
            for entry in entries.flatten() {
                let p = entry.path();
                let is_app = p.extension().map(|e| e == "app").unwrap_or(false);
                if is_app {
                    out.push(p.clone());
                }
                // Some apps are one level deeper, e.g. CoreServices/Applications/
                if !is_app && p.is_dir() {
                    let deeper = p.join("Applications");
                    if deeper.exists() {
                        if let Ok(sub) = fs::read_dir(&deeper) {
                            for e in sub.flatten() {
                                let sp = e.path();
                                if sp.extension().map(|ex| ex == "app").unwrap_or(false) {
                                    out.push(sp);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ~/Applications
    if let Some(home) = dirs::home_dir() {
        let user_apps = home.join("Applications");
        if user_apps.exists() {
            if let Ok(entries) = fs::read_dir(&user_apps) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().map(|e| e == "app").unwrap_or(false) {
                        out.push(p);
                    }
                }
            }
        }
    }

    out
}

#[cfg(not(target_os = "macos"))]
fn manual_app_dirs() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn extract_icon_base64(bundle_root: &Path) -> Option<String> {
    use base64::{engine::general_purpose, Engine as _};
    use std::fs::File;
    use std::io::{BufReader, Cursor};
    use tauri_icns::{IconFamily, IconType};

    let resources = bundle_root.join("Contents/Resources");

    // Try the standard AppIcon.icns, then any .icns fallback.
    let icns_path = resources.join("AppIcon.icns");
    let icns_path = if icns_path.exists() {
        icns_path
    } else {
        // Walk Resources for any .icns file.
        std::fs::read_dir(&resources)
            .ok()?
            .flatten()
            .find_map(|entry| {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) == Some("icns") {
                    Some(p)
                } else {
                    None
                }
            })?
    };

    let file = BufReader::new(File::open(&icns_path).ok()?);
    let family = IconFamily::read(file).ok()?;

    // Pick the largest available icon (cap at 128x128 to keep payload
    // under ~15KB per app — base64 512x512 PNGs would blow up Tauri IPC).
    let preferred = [
        IconType::RGBA32_128x128_2x,   // screen 128, actual 256
        IconType::RGBA32_128x128,      // screen 128, actual 128
        IconType::RGBA32_64x64,        // screen 64,  actual 64
        IconType::RGBA32_32x32_2x,     // screen 32,  actual 64
        IconType::RGBA32_32x32,        // screen 32,  actual 32
        IconType::RGBA32_16x16_2x,     // screen 16,  actual 32
        IconType::RGBA32_16x16,        // screen 16,  actual 16
    ];

    let best = preferred
        .iter()
        .find_map(|ty| family.get_icon_with_type(*ty).ok())?;

    let mut png = Vec::new();
    best.write_png(Cursor::new(&mut png)).ok()?;
    let b64 = general_purpose::STANDARD.encode(&png);
    Some(format!("data:image/png;base64,{b64}"))
}

#[cfg(not(target_os = "macos"))]
fn extract_icon_base64(_bundle: &Path) -> Option<String> {
    None
}

// ——— Running-apps detection (macOS osascript) ——————————————————————————————

/// Query macOS for the bundle identifiers of every foreground process.
/// Uses `osascript` so we avoid pulling in the Cocoa toolchain. Returns
/// an empty set on non-macOS platforms.
pub fn get_running_app_bundle_ids() -> HashSet<String> {
    let mut set = HashSet::new();
    #[cfg(target_os = "macos")]
    {
        // `background only is false` filters out daemons / helpers.
        let script = "tell application \"System Events\" to get bundle identifier of \
                       (every process whose background only is false)";
        if let Ok(out) = Command::new("osascript").arg("-e").arg(script).output() {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for raw in stdout.split(',') {
                    let id = raw.trim().trim_matches('"').to_string();
                    if !id.is_empty() && id != "missing value" {
                        set.insert(id);
                    }
                }
            }
        }
    }
    set
}

/// Spawn a background thread that periodically refreshes the
/// running-apps cache. The first refresh runs immediately.
pub fn spawn_running_apps_loop(
    cache: std::sync::Arc<std::sync::Mutex<HashSet<String>>>,
    interval: Duration,
) {
    std::thread::Builder::new()
        .name("launcher-running-apps".to_string())
        .spawn(move || {
            // Eager first refresh.
            {
                let snap = get_running_app_bundle_ids();
                if let Ok(mut g) = cache.lock() {
                    *g = snap;
                }
            }
            loop {
                std::thread::sleep(interval);
                let snap = get_running_app_bundle_ids();
                if let Ok(mut g) = cache.lock() {
                    *g = snap;
                }
            }
        })
        .expect("failed to spawn running-apps thread");
}

// ——— Launch / Quit ——————————————————————————————————————————————————————————

/// Launch an application bundle via `open(1)`.
/// Extra args are forwarded with `--args` on macOS.
pub fn launch_application(path: &str, args: Option<Vec<String>>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        if let Some(extra) = args {
            if !extra.is_empty() {
                cmd.arg("--args");
                for a in extra {
                    cmd.arg(a);
                }
            }
        }
        cmd.spawn()
            .map_err(|e| format!("failed to launch: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, args);
        Err("Launching applications is only supported on macOS".to_string())
    }
}

/// Quit a running app by its bundle identifier (best-effort osascript).
#[cfg(target_os = "macos")]
pub fn quit_application(bundle_id: &str) -> Result<(), String> {
    let script = format!("tell application id \"{bundle_id}\" to quit");
    let status = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status()
        .map_err(|e| format!("failed to invoke osascript: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("osascript exited with status {status}"))
    }
}

#[cfg(not(target_os = "macos"))]
pub fn quit_application(_bundle_id: &str) -> Result<(), String> {
    Err("Quitting applications is only supported on macOS".to_string())
}
