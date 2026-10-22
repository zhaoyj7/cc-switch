// 清掉无头构建里的 dead-code / unused-import 警告：
// 只被桌面分支使用的 import 直接按 feature 编译；
// 无头端由 stub  façade 接管、代码仍保留的项标 allow(dead_code)。
import fs from "node:fs";

const GATE = '#[cfg(feature = "desktop")]';
const ALLOW = '#[cfg_attr(not(feature = "desktop"), allow(dead_code))]';

// [file, 1-based 行号（在该行前插入）, 该行必须包含的锚点, 插入内容]
const edits = [
  ["commands/config.rs", 4, "use crate::compat::AppHandle;", GATE],
  ["commands/hermes.rs", 1, "use std::time::Duration;", GATE],
  ["commands/hermes.rs", 3, "use crate::compat::AppHandle;", GATE],
  ["commands/hermes.rs", 13, "const HERMES_WEB_OFFLINE_ERROR", ALLOW],
  ["commands/misc.rs", 13, "use crate::compat::AppHandle;", GATE],
  ["commands/misc.rs", 33, "fn validate_external_url", ALLOW],
  ["commands/misc.rs", 95, "fn portable_zip_url", ALLOW],
  ["commands/settings.rs", 3, "use tauri::{Emitter};", GATE],
  ["commands/settings.rs", 10, "struct UpdateDownloadProgress", ALLOW],
  ["commands/skill.rs", 18, "use crate::compat::AppHandle;", GATE],
  ["commands/workspace.rs", 3, "use crate::compat::AppHandle;", GATE],
  ["setup.rs", 25, "use crate::tray;", GATE],
  ["setup.rs", 26, "use crate::tray_panel;", GATE],
  ["setup.rs", 27, "use crate::url_for_log;", GATE],
  ["deeplink/mod.rs", 59, "static NEXT_PENDING_ID", ALLOW],
  ["deeplink/mod.rs", 68, "pub fn set_pending_deeplink", ALLOW],
  ["panic_hook.rs", 89, "pub fn get_log_dir", ALLOW],
  ["services/backup_storage.rs", 276, "pub fn location_dir", ALLOW],
  ["session_manager/content.rs", 677, "pub fn resolve_reveal_path", ALLOW],
  ["tray_panel_headless.rs", 8, "pub const USES_NATIVE_MENU", ALLOW],
];

// lib.rs 从后往前改，避免插入把后续行号顶掉。
const libEdits = [
  ["lib.rs", 901, "enum ExitRequestAction", ALLOW],
  ["lib.rs", 764, "fn is_chinese_locale", ALLOW],
  ["lib.rs", 276, "pub(crate) fn runtime_log_level_allows", ALLOW],
];

const byFile = new Map();
for (const [file, line, anchor, text] of [...edits, ...libEdits]) {
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ line, anchor, text });
}

for (const [file, list] of byFile) {
  const path = `src-tauri/src/${file}`;
  const lines = fs.readFileSync(path, "utf8").split("\n");
  for (const { line, anchor, text } of list.sort((a, b) => b.line - a.line)) {
    const idx = line - 1;
    if (!lines[idx].includes(anchor)) {
      throw new Error(`${file}:${line} 锚点不符：期望 "${anchor}"，实际 "${lines[idx]}"`);
    }
    if (lines[idx - 1]?.trim() === GATE || lines[idx - 1]?.trim() === ALLOW) continue;
    lines.splice(idx, 0, text);
  }
  fs.writeFileSync(path, lines.join("\n"), "utf8");
}

// set_windows_app_user_model_id 只在桌面构建用到
const libPath = "src-tauri/src/lib.rs";
let lib = fs.readFileSync(libPath, "utf8");
const before = '#[cfg(target_os = "windows")]\npub(crate) fn set_windows_app_user_model_id';
const after = '#[cfg(all(target_os = "windows", feature = "desktop"))]\npub(crate) fn set_windows_app_user_model_id';
if (!lib.includes(before)) throw new Error("set_windows_app_user_model_id 的 cfg 形态与预期不符");
lib = lib.replace(before, after);

// 只在桌面用到的原子标记 import
const beforeImport = "use std::sync::atomic::{AtomicBool, Ordering};";
if (!lib.includes(beforeImport)) throw new Error("找不到 AtomicBool import");
lib = lib.replace(beforeImport, `${GATE}\n${beforeImport}`);
fs.writeFileSync(libPath, lib, "utf8");

console.log(`已处理 ${byFile.size} 个文件`);
