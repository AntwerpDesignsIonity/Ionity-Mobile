/** In-process pub/sub hub broadcasting events to connected WebSocket clients. */

/** Minimal WebSocket surface we rely on (compatible with `ws`). */
export interface WsLike {
  readyState: number;
  send(data: string): void;
  on(event: "close" | "error", listener: () => void): void;
}

const WS_OPEN = 1; // ws.WebSocket.OPEN

export type HubEvent =
  | { type: "status"; data: unknown }
  | { type: "capture"; data: unknown }
  | { type: "calibration"; data: unknown }
  | { type: "localization"; data: unknown };

export class Hub {
  private readonly clients = new Set<WsLike>();

  add(socket: WsLike): void {
    this.clients.add(socket);
    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
  }

  broadcast(event: HubEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.clients) {
      if (socket.readyState === WS_OPEN) socket.send(payload);
    }
  }

  size(): number {
    return this.clients.size;
  }
}
