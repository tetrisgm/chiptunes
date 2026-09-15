// radio-presence — live listener count for Chiptunes.app (chiptunes.app).
//
// One global Durable Object ("station") holds every listener's WebSocket via
// the HIBERNATION API: the runtime keeps the sockets while the DO sleeps, so
// the web+desktop count is just getWebSockets().length — no storage writes, no
// alarms, and an idle station burns no duration quota. The site itself is
// Cloudflare Pages; a path-scoped route hands only /api/* to this Worker.
//
// AGGREGATE COUNT: the site shows ONE true total across every surface. The box
// runs broadcast/presence-reporter.mjs, which every ~45s POSTs the YouTube live
// concurrent-viewer count + the internet-radio (Roon/VLC) listener count to
// /api/presence/external (Bearer EXTERNAL_PRESENCE_SECRET). The DO folds those
// into `listeners`, so listeners = web/desktop WS + youtube + stream. External
// data older than EXTERNAL_TTL_MS is treated as 0 (the reporter is down), so a
// dead box can never freeze a stale phantom count on the site.

import { DurableObject } from "cloudflare:workers";

// External counts (youtube + stream) go stale after this long with no reporter
// POST — a down box then contributes 0 rather than a frozen phantom total. The
// reporter POSTs every ~45s, so ~3 min tolerates a few missed ticks.
const EXTERNAL_TTL_MS = 180000;

const ALLOWED_ORIGINS = new Set([
  "https://chiptunes.app",
  "https://www.chiptunes.app",
  "https://chiptunes.pages.dev",
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
      // Returns the AGGREGATE (web/desktop WS + youtube + stream).
      if (pathname === "/api/presence/count") {
        const resp = await station().fetch("https://do/count");
        return jsonResp(await resp.json(), resp.status, {
          "cache-control": "public, max-age=5",
          ...corsHeaders(origin),
        });
      }

      // Authenticated external-surface reporter (the box). POST
      // {youtube:int, stream:int}; guarded by a shared Bearer secret so only the
      // box can fold YouTube + internet-radio listeners into the total. Kept out
      // of the WS/count hot path; the DO persists just the last snapshot.
      if (pathname === "/api/presence/external") {
        if (request.method !== "POST") return jsonResp({ error: "method not allowed" }, 405);
        const secret = env.EXTERNAL_PRESENCE_SECRET;
        const auth = request.headers.get("authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        // A missing server secret must FAIL closed, never accept everything.
        if (!secret || token !== secret) return jsonResp({ error: "unauthorized" }, 401);
        let body;
        try { body = await request.json(); } catch (_) { return jsonResp({ error: "invalid json" }, 400); }
        const resp = await station().fetch("https://do/external", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return jsonResp(await resp.json(), resp.status);
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

  // Last external snapshot from the box reporter. In-memory for the hot path;
  // also persisted (in the ~45s POST path, never on a WS event) so a DO woken
  // from hibernation by a join still greets it with the aggregate.
  external = { youtube: 0, stream: 0, at: 0 };

  constructor(ctx, env) {
    super(ctx, env);
    // Client keepalive pings are answered by the runtime without waking us.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // Rehydrate the last external snapshot before serving any request.
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get("external");
      if (saved) this.external = saved;
    });
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

    const { pathname } = new URL(request.url);

    if (pathname === "/count") {
      const s = this.snapshot();
      return jsonResp({ listeners: s.total, web: s.web, youtube: s.youtube, stream: s.stream, now: Date.now() });
    }

    // Box reporter fold-in (auth already enforced by the outer Worker). Persist
    // the snapshot so a later hibernation wake still reports the aggregate, then
    // broadcast the new total to connected WS clients.
    if (pathname === "/external" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const clamp = (v) => Math.max(0, Math.floor(Number(v) || 0));
      this.external = { youtube: clamp(body.youtube), stream: clamp(body.stream), at: Date.now() };
      // Not a hot path (~45s cadence) — one small write here is cheap and keeps
      // the WS join/leave path write-free.
      this.ctx.storage.put("external", this.external);
      this.scheduleBroadcast();
      const s = this.snapshot();
      return jsonResp({ ok: true, listeners: s.total, web: s.web, youtube: s.youtube, stream: s.stream });
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

  // The single source of truth for the count. External surfaces are dropped to
  // 0 once their snapshot goes stale (reporter down), so the total degrades to
  // just the live web/desktop sockets instead of freezing.
  snapshot() {
    const web = this.ctx.getWebSockets().length;
    const fresh = this.external && Date.now() - this.external.at <= EXTERNAL_TTL_MS;
    const youtube = fresh ? (this.external.youtube || 0) : 0;
    const stream = fresh ? (this.external.stream || 0) : 0;
    return { web, youtube, stream, total: web + youtube + stream };
  }

  countMsg() {
    const s = this.snapshot();
    return { type: "count", listeners: s.total, web: s.web, youtube: s.youtube, stream: s.stream, now: Date.now() };
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
