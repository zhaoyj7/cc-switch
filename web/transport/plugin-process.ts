// 替代 @tauri-apps/plugin-process
export async function exit(_code: number): Promise<void> {
  // 无头服务不能因某个浏览器标签而退出，这里等价于断开界面
  window.close();
}

export async function relaunch(_options?: { type?: string }): Promise<void> {
  window.location.reload();
}
