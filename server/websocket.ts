import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import crypto from "crypto";
import { pool } from "./db";

let wss: WebSocketServer | null = null;
let activeConnections = 0;

// ──────────────────────────────────────────────────────
// Session cookie verification helpers
// ──────────────────────────────────────────────────────
//
// `express-session` stores the session id in a cookie named `connect.sid`
// whose value is `s:<sid>.<sig>` where `<sig>` is `HMAC-SHA256(<sid>, SECRET)`
// base64-encoded with trailing `=` stripped (see `cookie-signature`).
//
// The WS upgrade handler used to do a regex test on the cookie header which
// accepts a forged `Cookie: connect.sid=anything` value. Below we (a) verify
// the HMAC signature with `SESSION_SECRET`, then (b) look the sid up in the
// `sessions` table to confirm it's a known, unexpired session.

/** Parse the `Cookie` header into a name→value map. */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    // The session cookie is URL-encoded by `set-cookie`; decode if needed.
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Verify a signed connect.sid cookie value and return the bare sid, or null
 * if the signature is invalid / the cookie is malformed.
 *
 * Pure function — no I/O — so it's safe to unit-test without a DB.
 */
export function verifySignedSid(rawValue: string | undefined, secret: string): string | null {
  if (!rawValue || typeof rawValue !== "string") return null;
  if (!rawValue.startsWith("s:")) return null;
  const signed = rawValue.slice(2);
  const lastDot = signed.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const sid = signed.slice(0, lastDot);
  const providedSig = signed.slice(lastDot + 1);
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(sid)
    .digest("base64")
    .replace(/=+$/, "");
  // Constant-time compare; bail out if lengths differ to avoid throwing.
  if (providedSig.length !== expectedSig.length) return null;
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (!crypto.timingSafeEqual(a, b)) return null;
  return sid;
}

/**
 * Extract a session id from an incoming request's Cookie header.
 * Returns the bare sid (signature verified) or null.
 */
export function extractSessionId(req: IncomingMessage, secret: string): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  return verifySignedSid(cookies["connect.sid"], secret);
}

/**
 * Confirm the sid corresponds to a row in the `sessions` table whose
 * `expire` is in the future. Uses the shared pg pool.
 */
export async function sessionExistsInStore(sid: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM sessions WHERE sid = $1 AND expire > NOW()) AS exists",
    [sid],
  );
  return result.rows[0]?.exists === true;
}

/**
 * Full upgrade-time check: verify the cookie signature, then confirm the
 * session exists in PG. Returns true iff both pass.
 */
export async function isAuthenticatedUpgrade(req: IncomingMessage): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const sid = extractSessionId(req, secret);
  if (!sid) return false;
  try {
    return await sessionExistsInStore(sid);
  } catch (err) {
    console.error("WebSocket session lookup failed:", err);
    return false;
  }
}

export function setupWebSocket(httpServer: Server) {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") return; // let other upgrade handlers (vite HMR) through
    void isAuthenticatedUpgrade(req).then((ok) => {
      if (!ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss!.handleUpgrade(req, socket, head, (ws) => wss!.emit("connection", ws, req));
    });
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

// ──────────────────────────────────────────────────────
// K1 — Speed-to-Lead auction broadcasts.
// `auction_opened` fires when a high-MediScore lead is parked for the
// 10s claim window. `auction_resolved` fires once the resolver picks a
// winner (or determines no eligible claim arrived).
// ──────────────────────────────────────────────────────
export function broadcastAuctionOpened(payload: {
  leadId: number;
  orgId: string;
  candidateUserIds: string[];
  windowMs: number;
  opensAt: string;
  closesAt: string;
}) {
  if (!wss) return;
  const message = JSON.stringify({ type: "auction_opened", ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

export function broadcastAuctionResolved(payload: {
  leadId: number;
  winnerUserId: string | null;
  matchScore: number;
  reasons: string[];
  outcome: "won" | "expired" | "fallback";
}) {
  if (!wss) return;
  const message = JSON.stringify({ type: "auction_resolved", ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

export function getActiveConnections(): number {
  return activeConnections;
}

// Wave 6b (K3) — Dialer AI assist whisper. Broadcast to all connected
// sockets; the client filters by callLogId so only the agent on that call
// renders the suggestion.
export function broadcastAssistSuggestion(payload: {
  callLogId: number;
  suggestion: string;
  triggerPhrase: string;
}) {
  if (!wss) return;
  const message = JSON.stringify({ type: "assist_suggestion", ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

// Iterate every tracked client and request a graceful close with code 1001
// ("going away"). Used by the shutdown handler in server/index.ts so
// in-flight WebSockets are drained before the process exits.
type ClosableClient = { close: (code?: number, reason?: string) => void };
export function closeAllSockets(
  server: { clients: Iterable<ClosableClient> | ArrayLike<ClosableClient> } | null = wss,
): void {
  if (!server) return;
  const clients = Array.from(server.clients as Iterable<ClosableClient>);
  for (const client of clients) {
    try {
      client.close(1001, "shutdown");
    } catch {
      // ignore — best-effort during shutdown
    }
  }
}
