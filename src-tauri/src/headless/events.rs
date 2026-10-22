//! 事件桥：把 tauri 的 `emit` 转发到 SSE 通道，供浏览器端 `listen()` 使用。
//!
//! tauri 的 Rust 监听回调只拿到载荷、拿不到事件名，所以这里按名字逐个注册；
//! 名单就是旧前端真正在监听的那些事件，不做全量镜像。

use tauri::Listener;
use tokio::sync::broadcast;

use crate::compat;

/// 旧前端（src-legacy）实际订阅的事件名。
/// `tray-navigate` / `deeplink-pending` 不在其中：无头模式既没有托盘也没有深链接入口。
const BRIDGED_EVENTS: [&str; 8] = [
    "profile-applied",
    "universal-provider-synced",
    "provider-switched",
    "usage-log-recorded",
    "usage-cache-updated",
    "webdav-sync-status-updated",
    "s3-sync-status-updated",
    "update-download-progress",
];

/// 注册监听，把每条事件序列化成 `{"event":..,"payload":..}` 推给广播通道。
/// 与前端 `@tauri-apps/api/event` 的 `Event` 对象同形，shim 直接反序列化即可。
pub fn attach(app: &compat::AppHandle, sink: broadcast::Sender<String>) {
    for name in BRIDGED_EVENTS {
        let tx = sink.clone();
        app.listen(name, move |event| {
            let payload = serde_json::from_str::<serde_json::Value>(event.payload())
                .unwrap_or_else(|_| serde_json::Value::String(event.payload().to_string()));
            let frame = serde_json::json!({ "event": name, "payload": payload }).to_string();
            // 没有订阅者时 send 失败属正常（前端断开），无需处理。
            let _ = tx.send(frame);
        });
    }
}
