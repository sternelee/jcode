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

    /// Filter the index by a case-insensitive name / bundle-id query.
    /// An empty query returns the first 80 entries.
    pub fn search(&self, query: &str) -> Vec<AppInfo> {
        let lower = query.to_lowercase();
        if lower.is_empty() {
            return self.apps.iter().take(80).cloned().collect();
        }
        self.apps
            .iter()
            .filter(|a| app_matches(a, &lower))
            .take(80)
            .cloned()
            .collect()
    }

    /// Like [`search`], but additionally marks each result `running`
    /// when its bundle id appears in the provided set.
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
        // When the query is empty, surface running apps first.
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

fn app_matches(app: &AppInfo, lower: &str) -> bool {
    if app.name.to_lowercase().contains(lower) {
        return true;
    }
    if let Some(id) = app.bundle_id.as_ref() {
        if id.to_lowercase().contains(lower) {
            return true;
        }
    }
    false
}

// ——— Application scanning (macOS) —————————————————————————————————————————

#[cfg(target_os = "macos")]
fn scan_applications() -> Vec<AppInfo> {
    use applications::{AppInfo as _, AppInfoContext};

    let mut ctx = AppInfoContext::new(vec![]);
    // refresh_apps() queries LaunchServices + Spotlight — synchronous,
    // may take a few seconds on first call.
    if ctx.refresh_apps().is_err() {
        return Vec::new();
    }

    let raw = ctx.get_all_apps();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out: Vec<AppInfo> = Vec::with_capacity(raw.len());

    for app in raw {
        let bundle_path = bundle_root_from_crate_app(&app);

        if !seen.insert(bundle_path.clone()) {
            continue;
        }

        let (bundle_id, version, executable) =
            read_plist_metadata(&bundle_path);

        let icon_path = app
            .icon_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());

        let icon_base64 = extract_icon_base64(&bundle_path);

        out.push(AppInfo {
            name: app.name,
            bundle_id,
            icon_path,
            app_path: bundle_path.to_string_lossy().to_string(),
            executable_path: executable,
            version,
            icon_base64,
            running: false,
        });
    }

    out
}

/// Derive `.app` bundle root from the `applications` crate's `App`.
/// `app_path_exe` on macOS is the bundle directory itself (e.g.
/// `/Applications/Safari.app`), not the inner executable.
#[cfg(target_os = "macos")]
fn bundle_root_from_crate_app(app: &applications::App) -> PathBuf {
    // On macOS the crate sets app_path_exe to the .app directory.
    if let Some(p) = &app.app_path_exe {
        return p.clone();
    }
    // Fallback: app_desktop_path also points to the .app directory.
    app.app_desktop_path.clone()
}

/// Read `Info.plist` for fields the `applications` crate does not
/// surface: bundle identifier, short version, and executable name.
#[cfg(target_os = "macos")]
fn read_plist_metadata(
    bundle_root: &Path,
) -> (Option<String>, Option<String>, Option<String>) {
    use std::fs;

    let data = match fs::read(bundle_root.join("Contents/Info.plist")) {
        Ok(d) => d,
        Err(_) => return (None, None, None),
    };
    let dict = match plist::from_bytes::<plist::Value>(&data) {
        Ok(plist::Value::Dictionary(d)) => d,
        _ => return (None, None, None),
    };

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

    (bundle_id, version, executable)
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

    // Pick the largest available icon.
    let preferred = [
        IconType::RGBA32_512x512_2x,
        IconType::RGBA32_512x512,
        IconType::RGBA32_256x256_2x,
        IconType::RGBA32_256x256,
        IconType::RGBA32_128x128_2x,
        IconType::RGBA32_128x128,
        IconType::RGBA32_64x64,
        IconType::RGBA32_32x32,
        IconType::RGBA32_16x16,
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
