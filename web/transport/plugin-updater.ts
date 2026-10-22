// 替代 @tauri-apps/plugin-updater：服务端二进制的升级发生在服务器本机
// （换镜像 / 重新安装），浏览器标签页不能自更新，这里恒定为"无可用更新"。
export async function check(_options?: unknown): Promise<null> {
  return null;
}

export async function downloadAndInstall(_onProgress?: unknown): Promise<void> {
  throw new Error("无头服务请在服务器上升级");
}
