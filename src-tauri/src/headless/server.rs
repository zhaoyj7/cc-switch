//! 无头服务的 HTTP 层。
//!
//! 协议与 Tauri 的 IPC 一一对应，浏览器端只需替换 transport 就能跑旧前端：
//! - `POST /api/invoke` `{cmd, args}` → 调用同名 `#[tauri::command]`，
//!   成功返回命令原本的 JSON（失败用 500 + reject 值，前端据此 throw）；
//! - `GET /api/events` → SSE，推送后端 `emit` 的事件（见 `events` 模块）；
//! - `GET /api/meta` → 前端 `@tauri-apps/api/{app,path}` 需要的服务端信息（含鉴权）；
//! - `GET /api/health` → 免鉴权探活，给 systemd/docker 用；
//! - 其余路径 → rust-embed 打进二进制的前端静态资源，未命中回落 index.html。

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path as UrlPath, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio::sync::broadcast;

use super::assets;
use super::bootstrap::{HeadlessApp, DISPATCHER_LABEL};
use super::events;
use crate::compat;

pub const DEFAULT_PORT: u16 = 14515;

pub struct Config {
    pub bind: IpAddr,
    pub port: u16,
    pub token: Option<String>,
}

struct AppState {
    dispatcher: tauri::WebviewWindow<compat::Runtime>,
    events: broadcast::Sender<String>,
    token: Option<String>,
}

#[derive(Deserialize)]
struct InvokeBodyJson {
    cmd: String,
    #[serde(default)]
    args: serde_json::Value,
}

/// 起 HTTP 服务并阻塞到进程被终止。
pub async fn serve(headless: HeadlessApp, config: Config) -> Result<(), String> {
    let HeadlessApp { app, dispatcher } = headless;
    let handle = app.handle().clone();

    let (tx, _rx) = broadcast::channel::<String>(256);
    events::attach(&handle, tx.clone());

    let addr = SocketAddr::new(config.bind, config.port);
    let state = Arc::new(AppState {
        dispatcher,
        events: tx,
        token: config.token,
    });

    let router = Router::new()
        .route("/api/invoke", post(invoke))
        .route("/api/events", get(sse))
        .route("/api/health", get(health))
        .route("/api/meta", get(meta))
        // 只留这一条通配：`/assets/*path` 会把 "assets/" 前缀从捕获值里剥掉，
        // 而 rust-embed 的键是相对 dist-legacy 的 `assets/xxx`，前缀路由必然 404。
        .route("/*path", get(asset))
        .route("/", get(index))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), require_token))
        .with_state(state);

    log::info!("无头服务已启动：http://{addr}/（派发窗口 {DISPATCHER_LABEL}）");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("监听 {addr} 失败: {e}"))?;

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| format!("HTTP 服务异常退出: {e}"))?;

    // 与桌面版退出一样：把接了代理的客户端指回直连，再停掉代理服务。
    crate::cleanup_before_exit(&handle).await;
    Ok(())
}

/// `/api/*` 才鉴权（`/api/health` 除外）；静态资源不含用户数据，放行后
/// 页面才能加载起来并提示"需要令牌"。
async fn require_token(State(state): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    let guarded = path.starts_with("/api/") && path != "/api/health";
    if guarded && state.token.is_some() && !presented_token_matches(&state, &req) {
        return (StatusCode::UNAUTHORIZED, "需要有效的访问令牌").into_response();
    }
    next.run(req).await
}

/// 令牌可以从 `Authorization: Bearer` 或 `?token=` 来：EventSource 不能自定义
/// 请求头，SSE 只能用查询参数。
fn presented_token_matches(state: &AppState, req: &Request) -> bool {
    let Some(expected) = state.token.as_deref() else {
        return true;
    };
    let from_header = bearer_token(req.headers());
    let from_query = req.uri().query().and_then(query_token);
    matches!(from_header.or(from_query), Some(given) if given == expected)
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn query_token(query: &str) -> Option<&str> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("token="))
        .filter(|v| !v.is_empty())
}

async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "app": "cc-switch",
        "version": env!("CARGO_PKG_VERSION"),
        "authRequired": state.token.is_some(),
    }))
}

/// 前端 `@tauri-apps/api/app`（版本）与 `@tauri-apps/api/path`（homeDir、分隔符）
/// 需要的信息：路径反映的是服务器，不是浏览器所在机器。
async fn meta(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "homeDir": crate::config::get_home_dir().display().to_string(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "authRequired": state.token.is_some(),
    }))
}

async fn invoke(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<InvokeBodyJson>,
) -> Response {
    let dispatcher = state.dispatcher.clone();
    let outcome =
        tokio::task::spawn_blocking(move || dispatch(&dispatcher, body.cmd, body.args)).await;

    match outcome {
        Ok(Ok(response)) => response,
        Ok(Err(reject)) => (StatusCode::INTERNAL_SERVER_ERROR, reject).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("命令执行任务失败: {e}"),
        )
            .into_response(),
    }
}

/// 把一次 HTTP 调用翻译成 tauri 的 IPC 请求。`get_ipc_response` 同步等 channel，
/// 异步命令也是在 tauri 自己的运行时上跑完再回调，所以必须放在 blocking 线程里。
fn dispatch(
    dispatcher: &tauri::WebviewWindow<compat::Runtime>,
    cmd: String,
    payload: serde_json::Value,
) -> Result<Response, String> {
    let response = tauri::test::get_ipc_response(
        dispatcher,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(target_os = "windows") {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .expect("固定的本地 URL"),
            body: tauri::ipc::InvokeBody::Json(payload),
            headers: HeaderMap::new(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );

    match response {
        Ok(tauri::ipc::InvokeResponseBody::Json(text)) => Ok((
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            text,
        )
            .into_response()),
        Ok(tauri::ipc::InvokeResponseBody::Raw(bytes)) => Ok((
            StatusCode::OK,
            [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/octet-stream"),
                ),
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            ],
            bytes,
        )
            .into_response()),
        Err(reject) => Err(reject.to_string()),
    }
}

async fn sse(State(state): State<Arc<AppState>>) -> Response {
    let mut receiver = state.events.subscribe();
    let stream = async_stream::stream! {
        loop {
            match receiver.recv().await {
                Ok(frame) => yield Ok::<_, std::io::Error>(format!("data: {frame}\n\n")),
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!("SSE 订阅落后 {skipped} 条事件，前端应重新拉取数据");
                    yield Ok(format!(": lagged {skipped}\n\n"));
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    (
        [
            (
                header::CONTENT_TYPE,
                "text/event-stream; charset=utf-8".to_string(),
            ),
            (header::CACHE_CONTROL, "no-cache".to_string()),
            (header::CONNECTION, "keep-alive".to_string()),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

async fn index() -> Response {
    match asset_file("index.html") {
        Some(response) => response,
        None => (
            StatusCode::NOT_FOUND,
            "未内嵌前端资源：请先执行 npm run build:legacy:web 再编译无头版。",
        )
            .into_response(),
    }
}

/// 命中资源就返回；前端自己的路由（不含扩展名的路径）回落到 index.html，
/// 真正缺失的静态文件保持 404，便于发现构建产物对不上。
async fn asset(UrlPath(path): UrlPath<String>) -> Response {
    if let Some(response) = asset_file(&path) {
        return response;
    }
    if path.contains('.') {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }
    index().await
}

/// 静态资源命中就返回，未命中给 `None`；SPA 路由由调用方回落 index.html。
fn asset_file(path: &str) -> Option<Response> {
    let file = assets::get(path)?;
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Some(
        (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type(path)),
                (header::CACHE_CONTROL, cache),
            ],
            Body::from(file.data.to_vec()),
        )
            .into_response(),
    )
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

/// ctrl-c 与 systemd/docker 发来的 SIGTERM 都走优雅退出。
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut stream) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            stream.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => log::info!("收到 Ctrl-C，开始退出清理"),
        _ = terminate => log::info!("收到 SIGTERM，开始退出清理"),
    }
}
