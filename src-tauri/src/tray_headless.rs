//! 无头构建下的托盘门面：没有托盘，这些调用一律为空操作。
//!
//! 与 `tray.rs` 通过 `#[path]` 二选一绑定到 `crate::tray`，共享代码里的
//! `crate::tray::xxx(&app)` 调用点因此无需按 feature 分别改写。

use crate::compat::AppHandle;

pub fn refresh_tray_menu(_app: &AppHandle) {}

pub fn schedule_tray_refresh(_app: &AppHandle) {}

pub fn schedule_tray_status_check(_app: &AppHandle) {}

/// 启动流程走完的标记：桌面端据此让托盘开始提示「路由服务没在运行」，无头端没有托盘可提示。
pub fn mark_startup_settled(_app: &AppHandle) {}

/// 前端取托盘跳转意图：无头模式没有托盘，恒为空。
#[tauri::command]
pub fn take_tray_navigation() -> Option<serde_json::Value> {
    None
}

#[tauri::command]
pub fn tray_app_page_seen(_app: AppHandle, _app_type: String) {}
