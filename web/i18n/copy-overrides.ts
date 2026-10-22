type Messages = Record<string, unknown>;

/**
 * 按 "a.b.c" 路径覆盖若干条 locale 文案。
 *
 * src-legacy 必须与 v3.20.4 逐字节一致，所以说明文字只能从构建期别名注入
 * （见 vite.legacy.config.ts 的 I18N_OVERRIDES），不能改组件。
 */
export function withCopyOverrides<T extends Messages>(
  messages: T,
  overrides: Record<string, string>
): T {
  let patched: Messages = messages;
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split(".");
    const root = { ...patched };
    let cursor = root;
    for (const key of keys.slice(0, -1)) {
      const next: Messages = { ...((cursor[key] as Messages | undefined) ?? {}) };
      cursor[key] = next;
      cursor = next;
    }
    cursor[keys[keys.length - 1]] = value;
    patched = root;
  }
  return patched as T;
}
