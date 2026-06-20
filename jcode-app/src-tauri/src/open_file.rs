use std::path::Path;

#[derive(Debug, serde::Serialize)]
pub struct OpenError {
    message: String,
}

impl From<std::io::Error> for OpenError {
    fn from(err: std::io::Error) -> Self {
        OpenError {
            message: err.to_string(),
        }
    }
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), OpenError> {
    open_path(&path)
}

#[tauri::command]
pub fn open_parent_directory(path: String) -> Result<(), OpenError> {
    let p = Path::new(&path);
    let parent = p
        .parent()
        .and_then(|x| x.to_str())
        .unwrap_or(".")
        .to_string();
    open_path(&parent)
}

fn open_path(path: &str) -> Result<(), OpenError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", path])
            .spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}
