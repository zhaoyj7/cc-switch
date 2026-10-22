// 把 lib.rs 里 .setup(|app| { … }) 的闭包体搬到独立的 setup.rs，
// 让桌面构建与无头构建共用同一段初始化逻辑。
import fs from "node:fs";

const lib = "src-tauri/src/lib.rs";
const out = "src-tauri/src/setup.rs";

const lines = fs.readFileSync(lib, "utf8").split("\n");
const start = lines.findIndex((l) => l.trimEnd() === "        .setup(|app| {");
if (start === -1) throw new Error("找不到 .setup(|app| {");
let end = -1;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].trimEnd() === "        })" && lines[i + 1].includes(".invoke_handler")) {
    end = i;
    break;
  }
}
if (end === -1) throw new Error("找不到 setup 闭包的结束 })");

const body = lines.slice(start + 1, end).map((l) => {
  if (l.startsWith("        ")) return l.slice(8);
  return l;
});

const header = `//! 桌面与无头构建共用的初始化流程。
//!
//! Tauri 的 \`Builder::setup\` 闭包收到 \`&mut App<R>\`，桌面端 \`R = Wry\`、
//! 无头端 \`R = MockRuntime\`。把整段初始化写成对 \`compat::App\` 泛型化的函数，
//! 两种构建就只会有一条启动路径，数据库/供应商/同步等状态装配不会再各自漂移。
//! 只有窗口、托盘、深链接这类必须有 GUI 的段落按 \`feature = "desktop"\` 编译。

use crate::app_store;
use crate::commands;
use crate::compat;
#[cfg(feature = "desktop")]
use crate::handle_deeplink_url;
use crate::initialize_common_config_snippets;
#[cfg(feature = "desktop")]
use crate::runtime_log_level_allows;
use crate::show_database_init_error_dialog;
use crate::show_migration_error_dialog;
use crate::tray;
use crate::tray_panel;
use crate::url_for_log;
use crate::usage_events;
#[cfg(all(target_os = "linux", feature = "desktop"))]
use crate::linux_fix;
#[cfg(target_os = "windows")]
use crate::set_windows_app_user_model_id;
use crate::AppError;
use crate::AppState;
use crate::SkillService;
use std::sync::Arc;
use tauri::Manager;
#[cfg(feature = "desktop")]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
#[cfg(feature = "desktop")]
use tauri_plugin_deep_link::DeepLinkExt;

`;

const footer = `
/// 旧版 config.json 读失败时的处理：桌面端弹系统对话框让用户选择重试；
/// 无头端没有交互入口，记录原因后直接退出，交给 systemd/docker 的重启策略。
#[cfg(feature = "desktop")]
fn wait_for_migration_retry(app: &compat::AppHandle, error: &str) {
    if show_migration_error_dialog(app, error) {
        log::info!("用户选择重试加载配置文件");
    } else {
        log::info!("用户选择退出程序");
        std::process::exit(1);
    }
}

#[cfg(not(feature = "desktop"))]
fn wait_for_migration_retry(_app: &compat::AppHandle, error: &str) {
    log::error!("无头模式无法交互，旧配置加载失败即退出: {error}");
    std::process::exit(1);
}

/// 数据库打不开时的处理，与上面的旧配置迁移同样分桌面/无头两条路。
#[cfg(feature = "desktop")]
fn wait_for_database_retry(app: &compat::AppHandle, db_path: &std::path::Path, error: &str) {
    if show_database_init_error_dialog(app, db_path, error) {
        log::info!("用户选择重试初始化数据库");
    } else {
        log::info!("用户选择退出程序");
        std::process::exit(1);
    }
}

#[cfg(not(feature = "desktop"))]
fn wait_for_database_retry(
    _app: &compat::AppHandle,
    db_path: &std::path::Path,
    error: &str,
) {
    log::error!("无头模式无法交互，数据库初始化失败即退出: {db_path:?} {error}");
    std::process::exit(1);
}
`;

fs.writeFileSync(
  out,
  header +
    "pub fn setup_common(app: &mut compat::App) -> Result<(), Box<dyn std::error::Error>> {\n" +
    body.join("\n") +
    "\n}\n" +
    footer,
  "utf8",
);

const replaced = [
  ...lines.slice(0, start),
  "        .setup(crate::setup::setup_common)",
  ...lines.slice(end + 1),
];
fs.writeFileSync(lib, replaced.join("\n"), "utf8");

console.log(`setup.rs 写入 ${body.length} 行闭包体；lib.rs 由 ${lines.length} 行变为 ${replaced.length} 行`);
