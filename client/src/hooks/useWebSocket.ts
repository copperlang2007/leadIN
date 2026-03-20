import { useEffect, useRef, useState, useCallback } from "react";

export type WSStatus = "connecting" | "connected" | "disconnected";

interface WebSocketHookOptions {
  onNewLead?: (lead: any) => void;
}

export function useWebSocket({ onNewLead }: WebSocketHookOptions = {}) {
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const [lastLeadTime, setLastLeadTime] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const onNewLeadRef = useRef(onNewLead);
  const mountedRef = useRef(true);

  useEffect(() => {
    onNewLeadRef.current = onNewLead;
  }, [onNewLead]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (mountedRef.current) setStatus("connected");
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "new_lead") {
          setLastLeadTime(new Date());
          onNewLeadRef.current?.(data.lead);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      wsRef.current = null;
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { status, lastLeadTime };
}
