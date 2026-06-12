/** React hook: subscribe to the server's /ws event stream with auto-reconnect. */
import { useEffect, useRef, useState } from "react";
import type { HubEvent } from "./types";

export function useLiveEvents(onEvent: (event: HubEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (msg) => {
        try {
          handlerRef.current(JSON.parse(msg.data) as HubEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return { connected };
}
