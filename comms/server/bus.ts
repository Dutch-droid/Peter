/** Decouples services from the WebSocket hub: services publish, realtime.ts delivers. */
export type ServerEvent = { type: string; [k: string]: unknown };

type Sender = (userId: number, event: ServerEvent) => void;
let sender: Sender = () => {};
let onlineCheck: (userId: number) => boolean = () => false;

export function installTransport(send: Sender, isOnline: (userId: number) => boolean) {
  sender = send;
  onlineCheck = isOnline;
}

export function publish(userIds: Iterable<number>, event: ServerEvent) {
  for (const uid of new Set(userIds)) sender(uid, event);
}

export const isOnline = (userId: number) => onlineCheck(userId);
