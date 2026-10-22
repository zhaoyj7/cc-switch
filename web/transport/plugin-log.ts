// 替代 @tauri-apps/plugin-log：浏览器没有 tauri 的日志文件通道，
// 前端错误只落到 console。
export async function error(message: string): Promise<void> {
  console.error(message);
}

export async function warn(message: string): Promise<void> {
  console.warn(message);
}

export async function info(message: string): Promise<void> {
  console.info(message);
}
