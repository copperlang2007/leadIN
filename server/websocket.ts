import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer | null = null;
let activeConnections = 0;

export function setupWebSocket(httpServer: Server) {
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    activeConnections++;

    ws.on("close", () => {
      activeConnections--;
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });

    // Send a connection confirmation
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
    }
  });

  return wss;
}

export function broadcastNewLead(leadData: {
  id: number;
  type: string;
  state: string;
  zipCode: string;
  price: string;
  exclusivity: string;
  verified: boolean;
  vendorName: string;
  createdAt: string | null;
}) {
  if (!wss) return;

  const message = JSON.stringify({ type: "new_lead", lead: leadData });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function getActiveConnections(): number {
  return activeConnections;
}
