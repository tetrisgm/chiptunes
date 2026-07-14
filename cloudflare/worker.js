// radio-presence — live listener count for Retro Rave Radio (radio.ramine.net).
//
// One global Durable Object ("station") holds every listener's WebSocket via
// the HIBERNATION API: the runtime keeps the sockets while the DO sleeps, so
// the count is just getWebSockets().length — no storage writes, no alarms,
// and an idle station burns no duration quota. The site itself is Cloudflare
// Pages; a path-scoped route hands only /api/* to this Worker.

import { DurableObject } from "cloudflare:workers";

const ALLOWED_ORIGINS = new Set([
  "https://radio.ramine.net",
  "https://retro-rave-radio.pages.dev",
  "http://localhost:1338",
]);

const jsonResp = (obj, status = 200, extraHeaders = undefined) => {
  const h = new Headers(extraHeaders || {});
  h.set("content-type", "application/json");
  return new Response(JSON.stringify(obj), { status, headers: h });
};

// Mirror allowlisted origins back for CORS. A missing Origin (curl, native
// apps) is fine — it's a public read-only count.
const corsHeaders = (origin) =>
  origin && ALLOWED_ORIGINS.has(origin)
    ? { "access-control-allow-origin": origin, "vary": "origin" }
    : {};

export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      const origin = request.headers.get("origin") || "";
      const station = () => env.PRESENCE.get(env.PRESENCE.idFromName("station"));

      // WebSocket join: browsers always send Origin on upgrades, so block
      // other sites' pages; allow origin-less clients through.
      if (pathname === "/api/presence" &&
          (request.headers.get("upgrade") || "").toLowerCase() === "websocket") {
        if (origin && !ALLOWED_ORIGINS.has(origin)) {
          return jsonResp({ error: "origin not allowed" }, 403);
        }
        return await station().fetch(request); // 101 + client socket passes through
      }

      // Polling fallback. max-age=5 shields the DO from per-client bursts.
      if (pathname === "/api/presence/count") {
        const resp = await station().fetch("https://do/count");
        return jsonResp(await resp.json(), resp.status, {
          "cache-control": "public, max-age=5",
          ...corsHeaders(origin),
        });
      }

      return jsonResp({ error: "not found" }, 404);
    } catch (err) {
      return jsonResp({ error: "internal error" }, 500);
    }
  },
};

export class Presence extends DurableObject {
  // Debounce guard for broadcasts. Deliberately in-memory only: losing it to
  // hibernation is fine — any next join/leave event reschedules it.
  broadcastTimer = null;

  constructor(ctx, env) {
    super(ctx, env);
    // Client keepalive pings are answered by the runtime without waking us.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if ((request.headers.get("upgrade") || "").toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Hibernation API: ctx.acceptWebSocket, NOT server.accept() — the legacy
      // addEventListener pattern silently never hibernates.
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify(this.countMsg())); // greet the joiner immediately
      this.scheduleBroadcast(); // everyone else learns of the join, debounced
      return new Response(null, { status: 101, webSocket: client });
    }

    if (new URL(request.url).pathname === "/count") {
      return jsonResp({ listeners: this.ctx.getWebSockets().length, now: Date.now() });
    }

    return jsonResp({ error: "not found" }, 404);
  }

  // Clients send nothing (pings are auto-answered above); ignore anything else.
  webSocketMessage() {}

  webSocketClose() {
    this.scheduleBroadcast();
  }

  webSocketError() {
    this.scheduleBroadcast();
  }

  countMsg() {
    return { type: "count", listeners: this.ctx.getWebSockets().length, now: Date.now() };
  }

  // Coalesce join/leave churn into one broadcast ~1.5s later.
  scheduleBroadcast() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const msg = JSON.stringify(this.countMsg());
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(msg); } catch (_) { /* closing socket; its close event rebroadcasts */ }
      }
    }, 1500);
  }
}
