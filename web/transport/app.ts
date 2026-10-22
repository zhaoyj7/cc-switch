// 替代 @tauri-apps/api/app
import { getMeta } from "../client";

export async function getVersion(): Promise<string> {
  return (await getMeta()).version;
}
