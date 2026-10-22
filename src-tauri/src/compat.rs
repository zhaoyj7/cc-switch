//! 桌面构建与无头构建共用的 tauri 类型别名。
//!
//! tauri 的 `#[default_runtime(Wry, wry)]` 只在启用 `wry` feature 时才给
//! `AppHandle` 补上默认泛型参数，无头构建里裸写 `crate::compat::AppHandle` 会因缺少泛型参数而编译失败。
//! 全 crate 统一引用 `compat::AppHandle`，两种 feature 下都能编译。
//!
//! `Runtime` / `App` 同理：`setup` 回调收到的是 `&mut App<R>`，共用一条初始化
//! 路径需要把它写成对两种 R 都成立的签名。

#[cfg(feature = "desktop")]
pub use tauri::AppHandle;

#[cfg(not(feature = "desktop"))]
pub type AppHandle = tauri::AppHandle<tauri::test::MockRuntime>;

/// 两种构建各自的 Runtime：桌面端是真的 Wry 内核，无头端是 tauri::test 的 MockRuntime。
#[cfg(feature = "desktop")]
pub type Runtime = tauri::Wry;

#[cfg(not(feature = "desktop"))]
pub type Runtime = tauri::test::MockRuntime;

/// `Builder::setup` 闭包收到的 `&mut App<R>`，`setup_common` 用它同时服务两种构建。
pub type App = tauri::App<Runtime>;
