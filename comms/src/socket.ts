/** WebSocket client with automatic reconnect (backoff), request/reply, and an event fan-out. */
type Listener = (event: any) => void;

class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private attempt = 0;
  private stopped = true;
  private timer: number | undefined;
  connId: string | null = null;
  connected = false;

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  private open() {
    if (this.stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'hello') {
        this.connId = msg.connId;
        this.connected = true;
        this.attempt = 0;
      }
      if (msg.type === 'reply') {
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
        }
        return;
      }
      this.emit(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.connected;
      this.connected = false;
      this.connId = null;
      for (const p of this.pending.values()) p.reject(new Error('Connection lost'));
      this.pending.clear();
      if (was) this.emit({ type: 'socket:down' });
      if (this.stopped) return;
      const delay = Math.min(15_000, 500 * 2 ** this.attempt++) * (0.75 + Math.random() * 0.5);
      this.timer = window.setTimeout(() => this.open(), delay);
    };
  }

  /** Reconnect right away (e.g. when the tab regains focus or the network comes back). */
  nudge() {
    if (this.stopped || this.connected) return;
    clearTimeout(this.timer);
    this.attempt = 0;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    this.open();
  }

  private emit(e: any) {
    for (const l of this.listeners) l(e);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  request<T = any>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return reject(new Error('Not connected. Reconnecting…'));
      const reqId = Math.random().toString(36).slice(2);
      this.pending.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify({ ...msg, reqId }));
      setTimeout(() => {
        if (this.pending.delete(reqId)) reject(new Error('Timed out'));
      }, 15_000);
    });
  }
}

export const socket = new Socket();
window.addEventListener('online', () => socket.nudge());
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && socket.nudge());
