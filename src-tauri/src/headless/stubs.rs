//! 无头构建下，依赖窗口 / 对话框 / 托盘 / 自更新插件的命令的替身。
//!
//! 与 `commands/` 里的同名实现按 `desktop` feature 二选一，让 `app_invoke_handler!`
//! 那份共用注册表在两种构建下都能解析，所以**参数名必须与真实实现逐字一致**
//! （tauri 按参数名从 IPC payload 取值）。
//!
//! 语义取向：服务器上能真做的就真做（重启进程、设置主题、报无更新）；
//! 只有本机 GUI 能做的（打开目录、原生对话框）返回明确中文错误，由前端照常提示。

use crate::compat::AppHandle;

fn no_gui(what: &str) -> String {
    format!("无头模式（服务器）没有桌面环境，不支持{what}")
}

// ── 打开目录 / 文件 ──────────────────────────────────────────

#[tauri::command]
pub async fn open_config_folder(_handle: AppHandle, _app: String) -> Result<bool, String> {
    Err(no_gui("打开配置目录"))
}

#[tauri::command]
pub async fn open_app_config_folder(_handle: AppHandle) -> Result<bool, String> {
    Err(no_gui("打开应用配置目录"))
}

#[tauri::command]
pub async fn reveal_app_log_file() -> Result<bool, String> {
    Err(no_gui("在文件管理器中显示日志"))
}

#[tauri::command]
pub async fn reveal_backup_location(_id: String) -> Result<bool, String> {
    Err(no_gui("在文件管理器中显示备份"))
}

#[tauri::command]
pub async fn reveal_session_path(_path: String) -> Result<bool, String> {
    Err(no_gui("在文件管理器中显示会话路径"))
}

#[tauri::command]
pub async fn open_cc_switch_skills_dir(_handle: AppHandle) -> Result<bool, String> {
    Err(no_gui("打开技能目录"))
}

#[tauri::command]
pub async fn open_workspace_directory(_handle: AppHandle, _subdir: String) -> Result<bool, String> {
    Err(no_gui("打开工作区目录"))
}

#[tauri::command]
pub async fn open_hermes_web_ui(_app: AppHandle, _path: Option<String>) -> Result<(), String> {
    Err(no_gui("唤起本机浏览器"))
}

#[tauri::command]
pub async fn open_external(_app: AppHandle, _url: String) -> Result<bool, String> {
    Err("请在浏览器中直接打开该链接".into())
}

// ── 原生文件对话框 ───────────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn pick_directory(
    _app: AppHandle,
    #[allow(unused_variables)] defaultPath: Option<String>,
) -> Result<Option<String>, String> {
    Err(no_gui(
        "选择本机目录；数据目录请用启动参数 --data-dir 或环境变量 CC_SWITCH_DATA_DIR",
    ))
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn save_file_dialog(
    _app: AppHandle,
    #[allow(unused_variables)] defaultName: String,
) -> Result<Option<String>, String> {
    Err(no_gui("保存文件对话框"))
}

#[tauri::command]
pub async fn open_file_dialog(_app: AppHandle) -> Result<Option<String>, String> {
    Err(no_gui("文件选择对话框"))
}

#[tauri::command]
pub async fn open_zip_file_dialog(_app: AppHandle) -> Result<Option<String>, String> {
    Err(no_gui("ZIP 文件选择对话框"))
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_session_markdown(
    _app: AppHandle,
    #[allow(unused_variables)] defaultName: String,
    #[allow(unused_variables)] content: String,
) -> Result<Option<String>, String> {
    Err(no_gui("保存 Markdown 对话框"))
}

// ── 窗口 ─────────────────────────────────────────────────────

/// 无头模式没有窗口；主题由前端作用在 document 上，这里接受调用即可。
#[tauri::command]
pub async fn set_window_theme(_theme: String) -> Result<(), String> {
    Ok(())
}

// ── 应用生命周期 / 自更新 ────────────────────────────────────

/// 重启服务器进程：由 systemd / docker 的 Restart 策略拉起新版本。
#[tauri::command]
pub async fn restart_app(_app: AppHandle) -> Result<bool, String> {
    log::info!("收到重启请求，进程即将退出（由服务管理器重新拉起）");
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        std::process::exit(0);
    });
    Ok(true)
}

#[tauri::command]
pub async fn check_for_updates(_handle: AppHandle) -> Result<bool, String> {
    Err(no_gui("自动更新；请在服务器上升级"))
}

#[tauri::command]
pub async fn open_portable_update_download(
    _handle: AppHandle,
    _version: String,
) -> Result<bool, String> {
    Err(no_gui("下载便携版更新包"))
}

#[tauri::command]
pub async fn install_update_and_restart(_app: AppHandle) -> Result<bool, String> {
    Err(no_gui("自动更新；请在服务器上升级"))
}

/// 没有 updater 插件，等同于"无可用更新"。
#[tauri::command]
pub async fn check_app_update_available(_app: AppHandle) -> Result<Option<String>, String> {
    Ok(None)
}
