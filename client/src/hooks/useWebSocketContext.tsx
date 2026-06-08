import { createContext, useContext, useRef, useState, useEffect, useCallback, type ReactNode } from "react";

export type WSStatus = "connecting" | "connected" | "disconnected";

type NewLeadCallback = (lead: any) => void;
type AuctionMessageCallback = (msg: any) => void;

interface WebSocketContextValue {
  status: WSStatus;
  lastLeadTime: Date | null;
  subscribeToNewLeads: (cb: NewLeadCallback) => () => void;
  subscribeToAuctions: (cb: AuctionMessageCallback) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const [lastLeadTime, setLastLeadTime] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const subscribersRef = useRef<Set<NewLeadCallback>>(new Set());
  const auctionSubscribersRef = useRef<Set<AuctionMessageCallback>>(new Set());

  const subscribeToNewLeads = useCallback((cb: NewLeadCallback) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const subscribeToAuctions = useCallback((cb: AuctionMessageCallback) => {
    auctionSubscribersRef.current.add(cb);
    return () => {
      auctionSubscribersRef.current.delete(cb);
    };
  }, []);

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
          subscribersRef.current.forEach(cb => cb(data.lead));
        } else if (data.type === "auction_opened" || data.type === "auction_resolved") {
          auctionSubscribersRef.current.forEach(cb => cb(data));
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

  return (
    <WebSocketContext.Provider value={{ status, lastLeadTime, subscribeToNewLeads, subscribeToAuctions }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocketContext must be used within WebSocketProvider");
  return ctx;
}
