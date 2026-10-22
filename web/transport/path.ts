// 替代 @tauri-apps/api/path：路径属于服务端，不是浏览器所在机器
import { getMeta } from "../client";

export async function homeDir(): Promise<string> {
  return (await getMeta()).homeDir;
}

/** 服务端平台决定分隔符：Windows 服务用反斜杠，类 Unix 用正斜杠。 */
export async function join(...parts: unknown[]): Promise<string> {
  const meta = await getMeta();
  const sep = meta.os === "windows" ? "\\" : "/";
  const chunks = parts.filter((p) => p !== undefined && p !== null) as string[];
  if (chunks.length === 0) return "";
  const isAbsolute = (s: string) =>
    s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\");
  let out = chunks[0];
  for (const part of chunks.slice(1)) {
    if (isAbsolute(part)) {
      out = part;
      continue;
    }
    out = `${out.replace(/[\\/]+$/, "")}${sep}${part.replace(/^[\\/]+/, "")}`;
  }
  return out;
}
