// 旧前端 web 版的真实浏览器验收：用 Node 直接驱动 headless Chrome（CDP）。
// 不用内置浏览器：它挂不起 SPA 的覆盖层，也多撑几次导航。
//
// 前提：无头服务已在监听（默认 127.0.0.1:14515）。
// 用法：node tools/browser-e2e.mjs [页面地址]
//
// 零依赖：Node 24 起 WebSocket / fetch 都是全局。

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const CHROME =
  process.env.CC_E2E_CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PAGE = process.argv[2] ?? "http://127.0.0.1:14515/";

// 端口必须现挑：固定端口撞上别人在用的 headless Chrome 时，Chrome 会退到随机端口，
// 而脚本却连到那台陌生浏览器上跑完全部断言（本机踩过：另一项目的 chrome-profile2）。
const CDP_PORT = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.unref();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-e2e-profile-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function waitForCdp(deadlineMs = 20000) {
  const end = Date.now() + deadlineMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {}
    if (Date.now() > end) throw new Error(`Chrome 的 CDP 端口 ${CDP_PORT} 没起来`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** 极简 CDP 客户端：一条浏览器级连接 + 一个 flattened session。 */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = [];
    socket.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    this.socket.send(payload);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(handler) {
    this.handlers.push(handler);
  }
}

const evaluate = (cdp, sessionId, expression, opts = {}) =>
  cdp
    .send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, ...opts },
      sessionId
    )
    .then((r) => {
      if (r.exceptionDetails)
        throw new Error(`页面内异常: ${r.exceptionDetails.exception?.description ?? "见 CDP"}`);
      return r.result.value;
    });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let exitCode = 0;
try {
  const version = await waitForCdp();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), {
      once: true,
    });
  });
  const cdp = new Cdp(socket);

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  const consoleErrors = [];
  const failedRequests = [];
  const responses = [];
  await cdp.send("Log.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  cdp.on((msg) => {
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      // 带上来源 URL：Chrome 自己会探测 /favicon.ico，那条 404 不属于应用报错，
      // 只有记到 URL 才区分得开。
      const { text, url } = msg.params.entry;
      consoleErrors.push(url ? `${text} @ ${url}` : text);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Network.responseReceived") {
      const { url, status, mimeType } = msg.params.response;
      responses.push({ url, status, mimeType });
      if (status >= 400) failedRequests.push(`${status} ${url}`);
    }
  });

  await cdp.send("Page.navigate", { url: PAGE }, sessionId);
  await sleep(1500);

  // 等 React 挂载：轮询 #root 出现子节点
  let mounted = false;
  for (let i = 0; i < 40 && !mounted; i++) {
    mounted = await evaluate(
      cdp,
      sessionId,
      "Boolean(document.querySelector('#root')?.children.length)"
    );
    if (!mounted) await sleep(250);
  }
  check("旧前端挂载到 #root", mounted);

  const title = await evaluate(cdp, sessionId, "document.title");
  check("页面标题来自旧前端", title.includes("供应商切换器"), title);

  const bodyText = await evaluate(cdp, sessionId, "document.body.innerText");
  check(
    "渲染出数据库里的供应商（首启种子数据）",
    /Claude Official/i.test(bodyText),
    bodyText.slice(0, 80).replace(/\s+/g, " ")
  );

  const gated = await evaluate(
    cdp,
    sessionId,
    "Boolean(document.getElementById('cc-web-auth-gate'))"
  );
  check("没有卡在令牌输入门（本地无 token 直连）", !gated);

  const apiCalls = responses.filter((r) => r.url.includes("/api/"));
  const apiFailed = apiCalls.filter((r) => r.status >= 400);
  check(
    `/api/invoke 调用都成功（共 ${apiCalls.length} 次）`,
    apiCalls.some((r) => r.url.includes("/api/invoke")) && apiFailed.length === 0,
    apiFailed.join(" | ")
  );

  const sse = apiCalls.find((r) => r.url.includes("/api/events"));
  check("事件通道 SSE 已建立", Boolean(sse) && sse.status === 200, sse?.mimeType ?? "没有 /api/events 请求");

  const assetFailed = failedRequests.filter((u) => u.includes("/assets/"));
  check("静态资源全部命中", assetFailed.length === 0, assetFailed.join(" | "));

  // SSE 与命令派发是否真在跑：让页面自己发一次带参数的命令，走 transport 的 invoke
  // 令牌：页面 URL 上的 ?token= 会被 client.ts 存进 localStorage，这里两处都要带上。
  const TOKEN_JS =
    '(new URLSearchParams(location.search).get("token")||localStorage.getItem("cc-switch-web-token")||"")';
  const roundTrip = await evaluate(
    cdp,
    sessionId,
    `(()=>{const tk=${TOKEN_JS};return fetch("/api/invoke",{method:"POST",
      headers:Object.assign({"Content-Type":"application/json"}, tk?{Authorization:"Bearer "+tk}:{}),
      body:JSON.stringify({cmd:"get_stream_check_config",args:{}})}).then(r=>r.json())})()`
  );
  check(
    "移植的 get_stream_check_config 从浏览器可达",
    typeof roundTrip?.timeoutSecs === "number" && typeof roundTrip?.degradedThresholdMs === "number",
    JSON.stringify(roundTrip)
  );

  // 事件桥的真实帧：后端 emit → SSE 必须有内容到达浏览器
  const frames = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const tk = ${TOKEN_JS};
      const es = new EventSource("/api/events" + (tk ? "?token=" + encodeURIComponent(tk) : ""));
      const got = [];
      es.onmessage = (e) => { try { got.push(JSON.parse(e.data).event); } catch {} };
      const post = (cmd, args) =>
        fetch("/api/invoke", { method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, tk ? { Authorization: "Bearer " + tk } : {}),
          body: JSON.stringify({ cmd, args }) }).then((r) => r.json());
      const prof = await post("create_profile", { name: "e2e-sse", scope: "claude" });
      await post("apply_profile", { id: prof.id, scope: "claude" });
      await new Promise((r) => setTimeout(r, 2000));
      await post("delete_profile", { id: prof.id });
      es.close();
      return got;
    })()`
  );
  check(
    "profile 应用后事件帧真的到达浏览器",
    frames.includes("provider-switched") && frames.includes("profile-applied"),
    JSON.stringify(frames)
  );

  // 供应商表单里那两个「已停用但仍原样往返」的字段：说明文字必须自己讲清楚。
  // 表单在编辑弹窗里，按 input 的 id 定位（不依赖语言），Escape 用真实按键关掉。
  const formHints = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const fire = (el) => {
        const b = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, view: window, button: 0,
          clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
          el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, o) : new MouseEvent(type, o));
      };
      const edit = document.querySelector('button[aria-label="Edit"]');
      if (!edit) return { error: "找不到供应商卡片的编辑按钮" };
      fire(edit);
      for (let i = 0; i < 40 && !document.getElementById("cost-multiplier"); i++) await sleep(200);
      const mult = document.getElementById("cost-multiplier");
      const src = document.getElementById("pricing-model-source");
      if (!mult || !src) return { error: "编辑弹窗里没有计费字段" };
      return {
          multiplierHint: mult.parentElement?.querySelector("p")?.textContent.trim() ?? null,
        sourceHint: src.closest("div")?.querySelector("p")?.textContent.trim() ?? null,
      };
    })()`
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
    sessionId
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
    sessionId
  );
  const MULT_HINT = /v4 计费已不使用倍率|v4 計費已不使用倍率|no longer applies multipliers|v4 の課金計算では倍率を使用しません/;
  const SOURCE_HINT = /v4 只按全局|v4 僅依全域|global pricing mode|v4 はグローバル/;
  check(
    "供应商表单的倍率说明写明 v4 不使用",
    MULT_HINT.test(formHints?.multiplierHint ?? ""),
    JSON.stringify(formHints)
  );
  check(
    "供应商表单的计费模式说明写明 v4 只读全局",
    SOURCE_HINT.test(formHints?.sourceHint ?? ""),
    JSON.stringify(formHints?.sourceHint)
  );

  // 成本倍率：面板的读写走的就是这两条命令；值本身 v4 计费链路不消费（守卫测试
  // proxy::response_processor::tests::test_log_usage_ignores_legacy_multiplier_and_provider_overrides）。
  const mult = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const tk = ${TOKEN_JS};
      const post = (cmd, args) =>
        fetch("/api/invoke", { method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, tk ? { Authorization: "Bearer " + tk } : {}),
          body: JSON.stringify({ cmd, args }) }).then((r) => r.json());
      const before = await post("get_default_cost_multiplier", { appType: "claude" });
      await post("set_default_cost_multiplier", { appType: "claude", value: "1.75" });
      const after = await post("get_default_cost_multiplier", { appType: "claude" });
      return { before, after };
    })()`
  );
  check(
    "移植的 set/get_default_cost_multiplier 从浏览器可达",
    typeof mult?.before === "string" && mult?.after === "1.75",
    JSON.stringify(mult)
  );

  // 说明文案必须真在面板上：设置 → 用量 → 成本定价。
  // 齿轮按钮用 lucide 图标定位（无头 Chrome 的 navigator.language 是 en-US，标题随语言变）；
  // Radix 的 aria-controls / id 后缀不随语言变。
  const panel = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const fire = (el) => {
        const b = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, view: window, button: 0,
          clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
          el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, o) : new MouseEvent(type, o));
      };
      const gear = document.querySelector("button:has(svg.lucide-settings)");
      if (!gear) return { error: "找不到设置入口" };
      fire(gear);
      await sleep(800);
      const tab = document.querySelector('[role="tab"][aria-controls$="-usage"]');
      if (!tab) return { error: "找不到用量标签页" };
      fire(tab);
      await sleep(1500);
      // 折叠项没有语义化的 id 后缀可用，按面板自带的 Coins 图标定位
      const trigger = document.querySelector("button:has(svg.lucide-coins)");
      if (!trigger) return { error: "找不到成本定价折叠项" };
      fire(trigger);
      const body = () => document.getElementById(trigger.getAttribute("aria-controls"));
      const filled = () => body()?.querySelectorAll('input[type="number"]').length === 4;
      for (let i = 0; i < 40 && !filled(); i++) await sleep(200);
      await sleep(300);
      const root = body();
      if (!root) return { error: "定价面板没有展开" };
      return {
          headers: [...root.querySelectorAll("th")].map((e) => e.textContent.trim()),
        values: [...root.querySelectorAll('input[type="number"]')].map((e) => e.value),
      };
    })()`
  );
  const NOTE = /v4 计费不使用|v4 計費不使用|v4 課金では未使用|unused in v4 billing/;
  check(
    "定价面板标注了「v4 计费不使用倍率」",
    (panel?.headers ?? []).some((h) => NOTE.test(h)),
    JSON.stringify(panel)
  );
  check(
    "定价面板读到了数据库里的倍率（claude 行是上一步写进去的 1.75）",
    panel?.values?.[0] === "1.75" && (panel?.values ?? []).slice(1).every((v) => v === "1"),
    JSON.stringify(panel?.values)
  );

  // 面板开过了，把 claude 的倍率复位，别把状态留在 1.75
  const restored = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const tk = ${TOKEN_JS};
      const post = (cmd, args) =>
        fetch("/api/invoke", { method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, tk ? { Authorization: "Bearer " + tk } : {}),
          body: JSON.stringify({ cmd, args }) }).then((r) => r.json());
      await post("set_default_cost_multiplier", { appType: "claude", value: "1" });
      return post("get_default_cost_multiplier", { appType: "claude" });
    })()`
  );
  check("倍率已复位为 1", restored === "1", String(restored));

  const noisy = consoleErrors.filter((t) => !/favicon|ResizeObserver/i.test(t));
  const otherFailed = failedRequests.filter((u) => !/favicon/i.test(u));
  check(
    "浏览器控制台没有应用级报错",
    noisy.length === 0,
    [noisy.slice(0, 3).join(" | "), otherFailed.join(" | ")].filter(Boolean).join("  ·  ")
  );
} catch (err) {
  exitCode = 1;
  console.error(`E2E 执行失败: ${err?.message ?? err}`);
} finally {
  chrome.kill();
  // Chrome 退出前会锁住用户目录，删早了会 EPERM
  await new Promise((resolve) => {
    chrome.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed ? 1 : exitCode);
