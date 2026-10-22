//! 无头（only backend）模式：用 tauri 的 MockRuntime 装配真实状态，
//! 通过 HTTP 把 `#[tauri::command]` 暴露给浏览器前端，并托管内嵌的前端静态资源。

pub mod assets;
pub mod bootstrap;
pub mod events;
pub mod server;
pub mod stubs;

pub use server::serve;
