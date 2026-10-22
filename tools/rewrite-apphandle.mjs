// 把裸 tauri::AppHandle（默认泛型参数 = Wry）改写为 crate::compat::AppHandle，
// 使同一份代码在 desktop(wry) 与 headless(MockRuntime) 两种 feature 下都能编译。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src-tauri/src");
const BARE = /\btauri::AppHandle\b(?!::|<)/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".rs")) out.push(p);
  }
  return out;
}

let files = 0;
let sites = 0;
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  let text = src;

  // 1) use tauri::{AppHandle, X, Y}; / use tauri::AppHandle;
  text = text.replace(
    /^use tauri::\{([^}]*)\};$/gm,
    (m, inner) => {
      const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.includes("AppHandle")) return m;
      const rest = parts.filter((p) => p !== "AppHandle");
      const head = rest.length ? `use tauri::{${rest.join(", ")}};\n` : "";
      return `${head}use crate::compat::AppHandle;`;
    },
  );
  text = text.replace(/^use tauri::AppHandle;$/gm, "use crate::compat::AppHandle;");

  // 2) 其余裸引用
  const before = (text.match(BARE) || []).length;
  text = text.replace(BARE, "crate::compat::AppHandle");

  if (text !== src) {
    fs.writeFileSync(file, text);
    files++;
    sites += before;
    console.log(`${path.relative(ROOT, file)}: ${before}`);
  }
}
console.log(`\nfiles=${files} sites=${sites}`);
