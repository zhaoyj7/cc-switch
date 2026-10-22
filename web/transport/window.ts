// 替代 @tauri-apps/api/window：浏览器里没有系统窗口，尽量映射到等价行为
// 最大化 → 全屏；关闭 → 关标签页；最小化/装饰 → 无对应能力，空实现。
type ResizeHandler = () => void;
type FocusHandler = (evt: { payload: boolean }) => void;

class WebWindow {
  readonly label = "main";

  async isMaximized(): Promise<boolean> {
    return document.fullscreenElement !== null;
  }

  async toggleMaximize(): Promise<void> {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }

  async maximize(): Promise<void> {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  }

  async unmaximize(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
  }

  async minimize(): Promise<void> {}

  async close(): Promise<void> {
    window.close();
  }

  async setDecorations(_decorations: boolean): Promise<void> {}

  async setAlwaysOnTop(_value: boolean): Promise<void> {}

  async setTitle(_title: string): Promise<void> {}

  async title(): Promise<string> {
    return document.title;
  }

  async onResized(handler: ResizeHandler): Promise<() => void> {
    const onResize = () => handler();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }

  async onFocusChanged(handler: FocusHandler): Promise<() => void> {
    const on = (value: boolean) => () => handler({ payload: value });
    const focus = on(true);
    const blur = on(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }
}

const currentWindow = new WebWindow();

export function getCurrentWindow(): WebWindow {
  return currentWindow;
}

export function getCurrentWebviewWindow(): WebWindow {
  return currentWindow;
}

export { WebWindow };
