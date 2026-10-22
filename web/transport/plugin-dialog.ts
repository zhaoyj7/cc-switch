// 替代 @tauri-apps/plugin-dialog：无头服务没有原生对话框，用浏览器模态兜底
export type MessageDialogKind = "info" | "warning" | "error" | "question";

export async function message(
  message: string,
  options?: string | { title?: string; kind?: MessageDialogKind; type?: MessageDialogKind }
): Promise<void> {
  const title = typeof options === "string" ? options : options?.title;
  window.alert(title ? `${title}\n\n${message}` : message);
}
