//! 无头构建下的"轻量模式"门面：轻量模式是"隐藏主窗口只留托盘"，
//! 服务器上没有窗口，因此状态恒为 false，切换命令返回不支持。
//!
//! 与 `lightweight.rs` 通过 `#[path]` 二选一绑定到 `crate::lightweight`。

use crate::compat::AppHandle;

pub fn enter_lightweight_mode(_app: &AppHandle) -> Result<(), String> {
    Err("无头模式没有窗口可以隐藏".into())
}

pub fn exit_lightweight_mode(_app: &AppHandle) -> Result<(), String> {
    Err("无头模式没有窗口可以恢复".into())
}

pub fn is_lightweight_mode() -> bool {
    false
}
