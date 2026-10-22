import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();

function gitShow(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
  } catch {
    return null;
  }
}

function listFiles(ref, dir, filter) {
  const out = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", dir], {
    encoding: "utf8",
  });
  return out.split("\n").filter((f) => f && filter(f));
}

// "work" = 当前工作区（移植中的命令只在这里，读 git ref 是看不到的）。
const WORK = "work";

function readAt(ref, file) {
  if (ref === WORK) {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }
  return gitShow(ref, file);
}

function listAt(ref, dir, filter) {
  if (ref !== WORK) return listFiles(ref, dir, filter);
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(rel, { withFileTypes: true })) {
      const full = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (filter(full.replace(/\\/g, "/"))) out.push(full.replace(/\\/g, "/"));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function splitTop(s, sep = ",", opts = {}) {
  const out = [];
  let depth = 0,
    cur = "",
    inStr = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\") { cur += s[++i] ?? ""; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    // Rust 的生命周期标注（`'a`、`'_`）不是字符串起点。少了这条，解析
    // `State<'_, AppState>` 会把 `'` 当成开引号，整串参数被吞成空列表。
    if (opts.lifetimes && ch === "'" && /[A-Za-z_]/.test(s[i + 1] ?? "")) {
      cur += ch;
      do {
        i++;
        cur += s[i];
      } while (/[A-Za-z0-9_]/.test(s[i + 1] ?? ""));
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; cur += ch; continue; }
    if ("([{<".includes(ch)) depth++;
    if (")]}>".includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function stripComments(s) {
  return s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseCommands(src, file) {
  const res = new Map();
  const text = stripComments(src);
  // 属性可以带参数（`#[tauri::command(rename_all = "camelCase")]`），
  // 只匹配裸写的那一种会漏掉整个文件里的命令。
  const re = /#\[tauri::command(?:\(([^\n]*)\))?\]/g;
  let m;
  while ((m = re.exec(text))) {
    const after = text.slice(m.index + m[0].length);
    const fm = after.match(
      /^\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*(?:<[\s\S]{0,400}?>)?\s*\(/
    );
    if (!fm) continue;
    const name = fm[1];
    const open = fm.index + fm[0].length - 1;
    let depth = 0,
      close = -1;
    for (let i = open; i < after.length; i++) {
      if (after[i] === "(") depth++;
      else if (after[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    const params = splitTop(after.slice(open + 1, close), ",", { lifetimes: true })
      .map((p) => {
        // 参数级属性（`#[allow(non_snake_case)]`）会粘在名字前面，必须先剥掉，
        // 否则真实参数名会被当成不匹配。
        const cleaned = p.trim().replace(/^(#\[.*?\]\s*)+/g, "");
        const parts = splitTop(cleaned, ":", { lifetimes: true });
        const pname = (parts[0] || "").trim();
        const ptype = (parts.slice(1).join(":") || "").trim();
        return { name: pname, type: ptype.replace(/\s+/g, " ") };
      })
      .filter((p) => p.name && p.name !== "self");
    const rest = after.slice(close + 1);
    const retm = rest.match(/^\s*->\s*([\s\S]+?)(?:\s*\{|$)/);
    res.set(name, {
      file,
      params,
      ret: retm ? retm[1].trim().replace(/\s+/g, " ") : "",
      rename: (m[1] || "").includes("snake_case") ? "snake_case" : "camelCase",
    });
  }
  return res;
}

const INJECTED =
  /AppHandle|Window\s*<|WebviewWindow|InvokeResolver|AsyncRuntime|Manager\s*<|State\s*<|Webview\s*</;

// 只按类型判定注入参数：`app` 这个名字在 v3 里既可能是 AppHandle（注入），
// 也可能是 `app: String`（真实参数），按名字排除会把后者误判掉。
function isInjectedArg(p) {
  return INJECTED.test(p.type) || p.name === "_";
}

function sigOf(info) {
  if (!info) return null;
  return info.params
    .filter((p) => !isInjectedArg(p))
    .map((p) => `${p.name}: ${p.type}`)
    .join(", ");
}

function collect(ref) {
  const all = new Map();
  for (const f of listAt(ref, "src-tauri/src", (x) => x.endsWith(".rs"))) {
    const src = readAt(ref, f);
    if (!src || !src.includes("#[tauri::command")) continue;
    for (const [k, v] of parseCommands(src, f)) if (!all.has(k)) all.set(k, v);
  }
  return all;
}

function registered(ref) {
  // v3 直接在 lib.rs 里写 generate_handler!，v4 抽到了 command_handler.rs 的宏里；
  // 两个位置都找一遍，否则注册表读出来是空的（或只截到第一个 `]` 为止）。
  const candidates = ["src-tauri/src/command_handler.rs", "src-tauri/src/lib.rs"];
  const names = new Set();
  for (const file of candidates) {
    const src = readAt(ref, file);
    if (!src) continue;
    let from = 0;
    for (;;) {
      const at = src.indexOf("generate_handler![", from);
      if (at < 0) break;
      let i = at + "generate_handler![".length;
      let depth = 1;
      for (; i < src.length; i++) {
        if (src[i] === "[") depth++;
        else if (src[i] === "]") {
          depth--;
          if (depth === 0) break;
        }
      }
      for (const entry of splitTop(src.slice(at + "generate_handler![".length, i))) {
        const name = stripComments(entry).trim().split("::").pop();
        if (name) names.add(name);
      }
      from = i + 1;
    }
  }
  return names;
}

function frontendCalls(ref) {
  const calls = new Map();
  for (const f of listAt(ref, "src", (x) => /\.(ts|tsx)$/.test(x) && !/\.test\./.test(x))) {
    const src = stripComments(readAt(ref, f) || "");
    if (!src.includes("invoke")) continue;
    const re = /invoke(?:<[\s\S]{0,300}?>)?\s*\(\s*["']([a-z0-9_]+)["']\s*(?:,\s*(\{[\s\S]{0,800}?\})\s*)?\)/g;
    let m;
    while ((m = re.exec(src))) {
      const cmd = m[1];
      const keys = new Set();
      if (m[2]) {
        for (const pair of splitTop(m[2].slice(1, -1))) {
          const k = pair.match(/^\s*["']?([A-Za-z0-9_]+)["']?\s*:/);
          if (k) keys.add(k[1]);
        }
      }
      if (!calls.has(cmd)) calls.set(cmd, { keys: new Set(), sites: [] });
      for (const k of keys) calls.get(cmd).keys.add(k);
      calls.get(cmd).sites.push(f);
    }
  }
  return calls;
}

// 对齐目标默认取工作区：移植进来的命令还没提交，读 main 会漏掉。
// 前端调用点始终以 v3.20.4 为准（src-legacy 要求与它逐字节一致）。
const TARGET = process.argv[2] ?? WORK;
const v3cmds = collect("v3.20.4");
const maincmds = collect(TARGET);
const regV3 = registered("v3.20.4");
const regMain = registered(TARGET);
const calls = frontendCalls("v3.20.4");

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const norm = (t) => (t || "").replace(/[\s,]/g, "").replace(/&/g, "").toLowerCase();

const missing = [], changed = [], argMismatch = [], gone = [];
for (const [cmd, info] of [...calls].sort()) {
  if (!regV3.has(cmd)) continue; // not a real command (dynamic name etc.)
  if (!regMain.has(cmd)) { missing.push({ cmd, jsArgs: [...info.keys], sites: info.sites.slice(0, 3) }); continue; }
  const a = v3cmds.get(cmd), b = maincmds.get(cmd);
  if (!a || !b) { gone.push({ cmd, note: !a ? "no v3 fn found" : "no main fn found" }); continue; }
  const sa = sigOf(a), sb = sigOf(b);
  const retChanged = norm(a.ret) !== norm(b.ret);
  const renameChanged = a.rename !== b.rename;
  if (sa !== sb || retChanged || renameChanged)
    changed.push({
      cmd,
      v3: sa,
      main: sb,
      ret3: a.ret,
      retMain: b.ret,
      rename3: a.rename,
      renameMain: b.rename,
      sites: info.sites.slice(0, 3),
    });
  const rustNames = b.params.filter((p) => !isInjectedArg(p)).map((p) => p.name);
  const unmatched = [...info.keys].filter(
    (k) => k !== "args" && !rustNames.includes(snake(k)) && !rustNames.includes(k)
  );
  if (unmatched.length)
    argMismatch.push({
      cmd,
      jsArgs: [...info.keys],
      unmatched,
      rustArgs: rustNames,
      rename: b.rename,
      file: b.file,
    });
}

const addedInMain = [...regMain].filter((c) => !regV3.has(c)).sort();

const report = { missing, changed, argMismatch, addedInMain, counts: { regV3: regV3.size, regMain: regMain.size, feCmds: calls.size } };
fs.writeFileSync(path.join(REPO, "tools", "cmd-diff.json"), JSON.stringify(report, null, 2));

console.log(`registered: v3.20.4=${regV3.size} main=${regMain.size} | frontend invoke sites: ${calls.size}`);
console.log(`\n### REMOVED from ${TARGET} (${missing.length})`);
for (const x of missing) console.log(`- ${x.cmd}  jsArgs=[${x.jsArgs}]  e.g. ${x.sites[0]}`);
console.log(`\n### SIGNATURE CHANGED (${changed.length})`);
for (const x of changed) {
  console.log(`* ${x.cmd}`);
  console.log(`    v3:   ${x.v3}`);
  console.log(`    main: ${x.main}`);
  if (norm(x.ret3) !== norm(x.retMain)) console.log(`    ret:  ${x.ret3}  ->  ${x.retMain}`);
  if (x.rename3 !== x.renameMain) console.log(`    keys: ${x.rename3}  ->  ${x.renameMain}`);
}
console.log(`\n### JS ARG KEYS NOT FOUND IN main PARAMS (${argMismatch.length})`);
for (const x of argMismatch.slice(0, 40))
  console.log(
    `- ${x.cmd} [${x.rename}] (${x.file}): js=${x.jsArgs} unmatched=${x.unmatched} rust=${x.rustArgs}`
  );
console.log(`\n### ADDED in ${TARGET} (${addedInMain.length})\n${addedInMain.join(", ")}`);
if (gone.length) console.log(`\n### PARSE GAPS (${gone.length})\n${gone.map((g) => `${g.cmd}: ${g.note}`).join("\n")}`);
