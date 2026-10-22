//! `cc-switch-server`：无头服务模式（only backend）。
//!
//! 单二进制同时提供命令 API、事件流和旧前端页面，没有显示器也能跑。
//! 数据目录默认 `~/.cc-switch`，与桌面版一致；`--data-dir` 可以指向别处。

use std::net::IpAddr;

use cc_switch_lib::headless::bootstrap;
use cc_switch_lib::headless::server::{self, Config, DEFAULT_PORT};

const USAGE: &str = "\
用法: cc-switch-server [选项]

选项:
  --bind <地址>    监听地址，默认 127.0.0.1（只允许本机访问）
  --port <端口>    监听端口，默认 14515
  --token <令牌>   访问令牌；非本机监听必须设置。也可用环境变量 CC_SWITCH_TOKEN
                   （命令行参数会出现在 /proc/cmdline，systemd 建议用环境变量）
  --data-dir <目录> 数据目录，默认 ~/.cc-switch，也可用环境变量 CC_SWITCH_DATA_DIR
  --help           显示本帮助
";

fn main() {
    let code = match real_main() {
        Ok(()) => 0,
        Err(message) => {
            eprintln!("cc-switch-server 启动失败: {message}");
            1
        }
    };
    std::process::exit(code);
}

fn real_main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut bind: IpAddr = "127.0.0.1".parse().expect("固定的回环地址");
    let mut port = DEFAULT_PORT;
    let mut token: Option<String> = std::env::var("CC_SWITCH_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let mut value = |flag: &str| -> Result<String, String> {
            iter.next()
                .cloned()
                .ok_or_else(|| format!("{flag} 缺少参数值"))
        };
        match arg.as_str() {
            "--help" | "-h" => {
                print!("{USAGE}");
                return Ok(());
            }
            "--bind" => {
                let raw = value("--bind")?;
                bind = raw
                    .parse()
                    .map_err(|_| format!("--bind 的地址无法解析: {raw}"))?;
            }
            "--port" => {
                let raw = value("--port")?;
                port = raw
                    .parse()
                    .map_err(|_| format!("--port 的端口无法解析: {raw}"))?;
            }
            "--token" => token = Some(value("--token")?),
            "--data-dir" => {
                let raw = value("--data-dir")?;
                std::env::set_var("CC_SWITCH_DATA_DIR", raw);
            }
            other => return Err(format!("未知参数: {other}\n\n{USAGE}")),
        }
    }

    // 端口默认只绑回环：服务器上通常经 SSH 隧道或反向代理访问。
    // 一旦要对外监听，就必须带令牌，否则任何能连上的人都能读到 API Key。
    if !bind.is_loopback() && token.is_none() {
        return Err(
            "监听地址 {bind} 不是本机回环，必须用 --token 或 CC_SWITCH_TOKEN 设置访问令牌；\n\
             只想本机访问请改用 --bind 127.0.0.1。"
                .replace("{bind}", &bind.to_string()),
        );
    }

    let headless = bootstrap::build_app()?;
    log::info!("监听 {bind}:{port}");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("创建异步运行时失败: {e}"))?;

    runtime.block_on(server::serve(headless, Config { bind, port, token }))
}
