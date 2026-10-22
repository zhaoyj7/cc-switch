/**
 * Web 传输层客户端：把 Tauri 的 invoke / event 语义映射到 HTTP + SSE。
 * 协议由 src-tauri/src/headless/server.rs 实现，两端必须保持一致。
 */

const TOKEN_STORAGE_KEY = "cc-switch-web-token";

export interface WebMeta {
  version: string;
  homeDir: string;
  os: string;
  arch: string;
  authRequired: boolean;
}

let metaCache: WebMeta | null = null;

function readTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
    return token;
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

let token: string | null = null;

export function getToken(): string {
  if (token === null) token = readTokenFromUrl();
  return token ?? "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...extra, Authorization: `Bearer ${getToken()}` };
}

/** 401 时在同页给出重新输入 token 的入口，避免整页白屏。 */
function promptForToken(): void {
  if (document.getElementById("cc-web-auth-gate")) return;
  const box = document.createElement("div");
  box.id = "cc-web-auth-gate";
  box.setAttribute(
    "style",
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:Canvas;color:CanvasText;z-index:99999;font:14px system-ui"
  );
  box.innerHTML =
    '<form style="max-width:420px;padding:24px;border:1px solid currentColor;border-radius:12px;display:grid;gap:12px">' +
    "<p>连接 CC Switch 服务需要访问令牌（服务端用 --token 或 CC_SWITCH_TOKEN 配置）。</p>" +
    '<input name="token" type="password" autocomplete="off" style="padding:8px;border:1px solid currentColor;border-radius:6px;background:Field;color:FieldText" />' +
    '<button type="submit" style="padding:8px;border-radius:6px;border:1px solid currentColor;background:ButtonFace;color:ButtonText">保存并重载</button>' +
    "</form>";
  const form = box.querySelector("form")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = new FormData(form).get("token");
    if (typeof value === "string" && value.trim()) {
      localStorage.setItem(TOKEN_STORAGE_KEY, value.trim());
      location.reload();
    }
  });
  document.body.appendChild(box);
}

/** 与 Tauri 的 invoke 一致：成功返回命令的 Ok 载荷，失败 reject 后端的错误值。 */
export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const res = await fetch("/api/invoke", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ cmd, args: args ?? {} }),
  });
  if (res.status === 401) {
    promptForToken();
    throw new Error("unauthorized");
  }
  const text = await res.text();
  if (!res.ok) {
    throw decodeError(text);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** 后端错误体保持 Tauri 的形态：字符串或结构化对象，原样交给前端错误处理。 */
function decodeError(text: string): unknown {
  if (!text) return new Error("请求失败");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return new Error(parsed);
    if (parsed && typeof parsed.message === "string") return new Error(parsed.message);
    return parsed;
  } catch {
    return new Error(text);
  }
}

export async function getMeta(): Promise<WebMeta> {
  if (metaCache) return metaCache;
  const res = await fetch("/api/meta", { headers: authHeaders() });
  if (res.status === 401) {
    promptForToken();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`meta request failed: ${res.status}`);
  metaCache = (await res.json()) as WebMeta;
  return metaCache;
}

// ---------------------------------------------------------------------------
// 事件通道：一条 SSE 承载所有 Tauri 事件的转发，按事件名在本地分发。
// 后端只推送旧前端真正监听的那几个事件（src-tauri/src/headless/events.rs）。
// ---------------------------------------------------------------------------

type EventHandler = (payload: unknown) => void;

const listeners = new Map<string, Set<EventHandler>>();
let source: EventSource | null = null;

function connect(): void {
  if (source) return;
  // EventSource 不能带请求头，令牌走查询参数。
  source = new EventSource(`/api/events?token=${encodeURIComponent(getToken())}`);
  source.onmessage = (msg) => {
    let frame: { event?: string; payload?: unknown };
    try {
      frame = JSON.parse(String(msg.data)) as { event?: string; payload?: unknown };
    } catch {
      return;
    }
    if (!frame.event) return;
    const handlers = listeners.get(frame.event);
    if (!handlers) return;
    for (const handler of handlers) handler(frame.payload);
  };
  source.onerror = () => {
    // 连接中断但仍在自动重连时什么都不用做；被判为致命错误（多半是 401）
    // 才提示重新输入令牌，否则会放任浏览器无限重试。
    if (source?.readyState === EventSource.CLOSED) {
      source = null;
      promptForToken();
    }
  };
}

export function listenEvent(event: string, handler: EventHandler): () => void {
  let handlers = listeners.get(event);
  if (!handlers) {
    handlers = new Set();
    listeners.set(event, handlers);
  }
  handlers.add(handler);
  connect();
  return () => {
    const current = listeners.get(event);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) listeners.delete(event);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}
