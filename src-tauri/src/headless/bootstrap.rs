//! 无头应用的装配：跑的是和桌面版一模一样的 `setup_common`（同一个数据库、
//! 同一套服务与后台任务），只是运行时换成 `tauri::test` 的 MockRuntime——
//! 不建窗口、不需要显示器，因此可以直接跑在没有 GPU/X11 的服务器上。

use std::io::Write;

use crate::compat;

/// IPC 派发载体的窗口标签。MockRuntime 下并不会真的建窗，它只是
/// `tauri::test::get_ipc_response` 需要的 webview 上下文。
pub const DISPATCHER_LABEL: &str = "main";

/// tauri.conf.json 里与应用标识相关的三项：无头版不解析整份配置（不内嵌 ../dist，
/// 前端资源由 rust-embed 打进二进制），但路径解析必须与桌面版一致。
const APP_CONFIG_JSON: &str = include_str!("../../tauri.conf.json");

fn config_str(pointers: &[&str]) -> Option<String> {
    let root = serde_json::from_str::<serde_json::Value>(APP_CONFIG_JSON).ok()?;
    let mut node = &root;
    for key in pointers {
        node = node.get(key)?;
    }
    node.as_str().map(str::to_string)
}

/// 只写 stderr 的 log sink：无头版由 systemd/docker 的日志驱动负责收集与轮转，
/// 不再用桌面版的 tauri-plugin-log（那是给 webview 前端转发日志用的）。
struct StderrLogger;

impl log::Log for StderrLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
        let mut stderr = std::io::stderr().lock();
        let _ = writeln!(
            stderr,
            "{now} [{}] {}：{}",
            record.level(),
            record.target(),
            record.args()
        );
    }

    fn flush(&self) {
        let _ = std::io::stderr().flush();
    }
}

fn install_logger() {
    static LOGGER: StderrLogger = StderrLogger;
    // 桌面版进程里 logger 由 tauri-plugin-log 安装，无头版是独立二进制，
    // 这里必然成功；失败只可能是重复初始化，忽略即可。
    let _ = log::set_logger(&LOGGER);
    log::set_max_level(log::LevelFilter::Info);
}

pub struct HeadlessApp {
    pub app: compat::App,
    pub dispatcher: tauri::WebviewWindow<compat::Runtime>,
}

impl HeadlessApp {
    pub fn handle(&self) -> &compat::AppHandle {
        self.app.handle()
    }
}

/// 装配无头应用：注册 store 插件（数据目录覆盖能力与桌面端同源）、共用 setup_common
/// 初始化、展开与桌面端同一张命令注册表。
pub fn build_app() -> Result<HeadlessApp, String> {
    install_logger();
    crate::panic_hook::setup_panic_hook();

    // 数据目录先建好：无头版多跑在容器/systemd 下，首次启动时 ~/.cc-switch（或
    // --data-dir 指定处）往往还不存在，而数据库初始化失败在无头端只能退出。
    let data_dir = crate::config::get_app_config_dir();
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("创建数据目录 {} 失败: {e}", data_dir.display()))?;
    log::info!("数据目录: {}", data_dir.display());

    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    {
        let config = context.config_mut();
        config.identifier = config_str(&["identifier"]).ok_or("tauri.conf.json 缺少 identifier")?;
        config.product_name = config_str(&["productName"]);
        config.version = config_str(&["version"]);
    }

    let mut app = tauri::test::mock_builder()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(crate::app_invoke_handler!())
        .build(context)
        .map_err(|e| format!("无头应用装配失败: {e}"))?;

    // tauri 只在事件循环的 Ready 事件里调用 `.setup` 钩子（见 tauri::app 的
    // make_run_event_loop_callback），无头版从不 run()，所以这里手动跑同一条
    // 初始化路径。AppState 等都靠它 manage，缺了这一步所有命令都会 "state not managed"。
    crate::setup::setup_common(&mut app).map_err(|e| format!("无头应用初始化失败: {e}"))?;

    let dispatcher = tauri::WebviewWindowBuilder::new(&app, DISPATCHER_LABEL, Default::default())
        .build()
        .map_err(|e| format!("创建命令派发载体失败: {e}"))?;

    Ok(HeadlessApp { app, dispatcher })
}
