// 替代 @tauri-apps/api/event：Tauri 事件流走 /api/events WebSocket
import { listenEvent } from "../client";

export type EventId = number;

export interface Event<T = unknown> {
  id: EventId;
  event: string;
  payload: T;
}

export type UnlistenFn = () => void;

export async function listen<T = unknown>(
  event: string,
  handler: (evt: Event<T>) => void
): Promise<UnlistenFn> {
  return listenEvent(event, (payload) =>
    handler({ id: 0, event, payload: payload as T })
  );
}
