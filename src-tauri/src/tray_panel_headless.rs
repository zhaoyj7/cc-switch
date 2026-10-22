//! 无头构建下的托盘面板门面：没有面板，命令只报"不支持"。
//!
//! 与 `tray_panel.rs` 通过 `#[path]` 二选一绑定到 `crate::tray_panel`。

use crate::compat::AppHandle;
use serde_json::Value;

#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
pub const USES_NATIVE_MENU: bool = false;

#[tauri::command]
pub fn tray_panel_state() -> Result<Value, String> {
    Err("无头模式没有托盘面板".into())
}

#[tauri::command]
pub fn tray_panel_placement(_app: AppHandle) -> Option<Value> {
    None
}

#[tauri::command]
pub fn tray_panel_layout(_app: AppHandle, _layout: Value) {}

#[tauri::command]
pub fn tray_panel_hide(_app: AppHandle) {}

#[tauri::command]
pub async fn tray_panel_action(_app: AppHandle, _id: String) {}
