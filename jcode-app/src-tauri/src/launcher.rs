use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// Lightweight summary of a macOS application for the launcher UI.
///
/// We intentionally do not depend on `applications-rs` directly here. That crate
/// pulls a large Objective-C / Cocoa toolchain and exposes `App { name,
/// icon_path, app_path_exe, app_desktop_path }` without a bundle id. Instead,
/// we scan the well-known application directories ourselves and parse each
/// `Info.plist` to extract the small set of fields the UI needs.
///
/// `rename_all = "camelCase"` keeps the wire format in sync with the
/// TypeScript `AppInfo` interface in `src/lib/launcherTypes.ts`. Without
/// this, fields like `bundleId`/`iconPath` would arrive as `undefined`
/// in the launcher and the secondary line would render `undefined`.
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
    /// True when the app is currently running. Populated at search time by
    /// combining the static `AppIndex` with the live `running_apps` set.
    #[serde(default)]
    pub running: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppIndex {
    apps: Vec<AppInfo>,
}

impl AppIndex {
    pub fn refresh(&mut self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let apps = std::thread::Builder::new()
                .name("launcher-app-scan".to_string())
                .spawn(scan_applications)
                .map_err(|e| format!("Failed to spawn scanner thread: {e}"))?
                .join()
                .map_err(|_| "Application scanner thread panicked".to_string())?;
            let mut apps = apps;
            apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            self.apps = apps;
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.apps = Vec::new();
            Ok(())
        }
    }

    pub fn search(&self, query: &str) -> Vec<AppInfo> {
        let query_lower = query.to_lowercase();
        if query_lower.is_empty() {
            return self.apps.iter().take(80).cloned().collect();
        }
        self.apps
            .iter()
            .filter(|app| app_matches(app, &query_lower))
            .take(80)
            .cloned()
            .collect()
    }

    /// Like [`search`], but additionally flags each result as `running` if
    /// its bundle identifier appears in the provided set. The runtime
    /// maintains the set in a background thread (see `spawn_running_apps_loop`).
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
        // When no query, surface running apps first so they appear at the
        // top of the launcher's list (cmdk auto-selects the first item).
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

fn app_matches(app: &AppInfo, lower_query: &str) -> bool {
    if app.name.to_lowercase().contains(lower_query) {
        return true;
    }
    if let Some(id) = app.bundle_id.as_ref() {
        if id.to_lowercase().contains(lower_query) {
            return true;
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn scan_applications() -> Vec<AppInfo> {
    use std::fs;

    let mut roots: Vec<PathBuf> = Vec::new();
    roots.push(PathBuf::from("/System/Applications"));
    roots.push(PathBuf::from("/System/Library/CoreServices/Applications"));
    roots.push(PathBuf::from("/Applications"));
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }

    let mut apps: Vec<AppInfo> = Vec::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    for root in roots {
        if !root.exists() {
            continue;
        }
        let entries = match fs::read_dir(&root) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(ext) = path.extension() else {
                continue;
            };
            if ext != "app" {
                continue;
            }
            if !seen.insert(path.clone()) {
                continue;
            }
            if let Some(info) = read_app_info(&path) {
                apps.push(info);
            }
        }
    }
    apps
}

#[cfg(target_os = "macos")]
fn read_app_info(app_path: &Path) -> Option<AppInfo> {
    use std::fs;

    let plist_path = app_path.join("Contents/Info.plist");
    let data = fs::read(&plist_path).ok()?;
    let value: plist::Value = plist::from_bytes(&data).ok()?;

    let dict = value.as_dictionary()?;

    let name = dict
        .get("CFBundleName")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string())
        .or_else(|| {
            dict.get("CFBundleDisplayName")
                .and_then(|v| v.as_string())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| {
            app_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string()
        });

    let bundle_id = dict
        .get("CFBundleIdentifier")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string());

    let executable_path = dict
        .get("CFBundleExecutable")
        .and_then(|v| v.as_string())
        .map(|exe| {
            app_path
                .join("Contents/MacOS")
                .join(exe)
                .to_string_lossy()
                .to_string()
        });

    // Prefer high-resolution iconset PNGs over the bundled `.icns` —
    // modern macOS apps ship an `AppIcon.iconset/` directory of PNGs
    // at multiple sizes, which the webview renders crisply at any DPR.
    let icon_path = resolve_icon_path(app_path, dict);

    let version = dict
        .get("CFBundleShortVersionString")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string())
        .or_else(|| {
            dict.get("CFBundleVersion")
                .and_then(|v| v.as_string())
                .map(|s| s.to_string())
        });

    Some(AppInfo {
        name,
        bundle_id,
        icon_path,
        app_path: app_path.to_string_lossy().to_string(),
        executable_path,
        version,
        running: false,
    })
}

#[cfg(target_os = "macos")]
fn resolve_icon_path(app_path: &Path, dict: &plist::Dictionary) -> Option<String> {
    let resources_dir: PathBuf = app_path.join("Contents/Resources");

    // 1. Try the modern iconset directory. Apps built against the
    //    current macOS SDK put retina PNGs here, e.g.
    //    `icon_128x128@2x.png` (256x256). We pick the largest entry.
    let iconset = resources_dir.join("AppIcon.iconset");
    if let Some(png) = largest_png_in(&iconset) {
        return Some(png.to_string_lossy().to_string());
    }

    // 2. Try the legacy single-file icon declared in Info.plist
    //    (`CFBundleIconFile` → e.g. `AppIcon.icns`).
    let file = dict
        .get("CFBundleIconFile")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string());
    if let Some(name) = file {
        let base = resources_dir.join(&name);
        for candidate in [base.with_extension("icns"), base] {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    // 3. Last resort: any `.icns` directly in Contents/Resources.
    if let Ok(entries) = std::fs::read_dir(&resources_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("icns") {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Find the largest PNG in an iconset directory by parsing each file's
/// size out of its name (`icon_128x128@2x.png` → 256×256 = 65536 px²).
/// Returns the path to the largest, or `None` if no PNGs were found.
fn largest_png_in(iconset: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(iconset).ok()?;
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("png") {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(area) = parse_icon_size(name) else {
            continue;
        };
        if best.as_ref().map_or(true, |(prev, _)| area > *prev) {
            best = Some((area, path));
        }
    }
    best.map(|(_, p)| p)
}

/// Parse the pixel area out of an iconset filename. Handles
/// `icon_16x16.png`, `icon_128x128@2x.png`, and similar variants.
fn parse_icon_size(name: &str) -> Option<u64> {
    // Pull the two numeric runs that should appear in the filename.
    let mut numbers: Vec<u64> = name
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse().ok())
        .collect();
    if numbers.len() < 2 {
        return None;
    }
    let w = numbers.remove(0);
    let h = numbers.remove(0);
    if w == 0 || h == 0 {
        return None;
    }
    let mut area = w * h;
    if name.contains("@2x") {
        // 2x scale in each dimension = 4x area
        area *= 4;
    } else if name.contains("@3x") {
        area *= 9;
    }
    Some(area)
}

/// Query macOS for the bundle identifiers of every foreground app that is
/// currently running. Uses `osascript` so we avoid pulling in the Cocoa
/// toolchain. Returns an empty set on non-macOS platforms.
pub fn get_running_app_bundle_ids() -> HashSet<String> {
    let mut set = HashSet::new();
    #[cfg(target_os = "macos")]
    {
        // `background only is false` filters out daemons and helper
        // processes, which keeps the list focused on user-facing apps.
        let script = "tell application \"System Events\" to get bundle identifier of (every process whose background only is false)";
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

/// Spawn a background thread that periodically refreshes the running-apps
/// cache shared with the rest of the app. The cache is updated eagerly
/// (first refresh runs immediately) and then every `interval` thereafter.
pub fn spawn_running_apps_loop(
    cache: std::sync::Arc<std::sync::Mutex<HashSet<String>>>,
    interval: Duration,
) {
    std::thread::Builder::new()
        .name("launcher-running-apps".to_string())
        .spawn(move || loop {
            let snapshot = get_running_app_bundle_ids();
            if let Ok(mut guard) = cache.lock() {
                *guard = snapshot;
            }
            std::thread::sleep(interval);
        })
        .expect("failed to spawn running-apps thread");
}

pub fn launch_application(path: &str, args: Option<Vec<String>>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        if let Some(extra) = args {
            if !extra.is_empty() {
                cmd.arg("--args");
                for arg in extra {
                    cmd.arg(arg);
                }
            }
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to launch application: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, args);
        Err("Launching applications is only supported on macOS".to_string())
    }
}

/// Quit a running app by its bundle identifier. Best-effort: returns
/// `true` if the app was found in the running cache so the caller can
/// surface a "stopped" state without a separate lookup.
#[cfg(target_os = "macos")]
pub fn quit_application(bundle_id: &str) -> Result<(), String> {
    let script = format!("tell application id \"{bundle_id}\" to quit");
    let status = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status()
        .map_err(|e| format!("Failed to invoke osascript: {e}"))?;
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
