import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";

let wss: WebSocketServer | null = null;
let activeConnections = 0;

// Verifies the upgrade request carries a logged-in session cookie. We don't
// fully decode the session here — just confirm one exists, which the rest of
// the system enforces via routes. This blocks fully-anonymous subscribers
// from observing internal events like `lead_assignment`.
function hasSessionCookie(req: IncomingMessage): boolean {
  const cookie = req.headers.cookie ?? "";
  return /(?:^|;\s*)connect\.sid=/.test(cookie);
}

export function setupWebSocket(httpServer: Server) {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") return; // let other upgrade handlers (vite HMR) through
    if (!hasSessionCookie(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss!.handleUpgrade(req, socket, head, ws => wss!.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    activeConnections++;
    ws.on("close", () => { activeConnections--; });
    ws.on("error", (err) => { console.error("WebSocket error:", err); });
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

export function broadcastLeadAssignment(payload: {
  agentUserId: string;
  leadId: number;
  matchScore: number;
}) {
  if (!wss) return;
  const message = JSON.stringify({ type: "lead_assignment", ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

export function getActiveConnections(): number {
  return activeConnections;
}
