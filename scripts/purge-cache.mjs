#!/usr/bin/env node
// Post-deploy Cloudflare edge-cache purge for chiptunes.app.
//
// Why this exists: Pages deployments are atomic, but any asset we serve with a
// Cache-Control max-age (e.g. the radio.pls / radio.m3u playlist files via
// assets/_headers) gets held at the edge, so a fresh deploy can keep serving the
// OLD file until its TTL expires. Purging once after every deploy makes the
// pipeline self-healing: what you deployed is what the world sees, immediately.
//
// Creds: CLOUDFLARE_API_TOKEN from ~/.config/stack/cloudflare.env (the token
// carries Zone > Cache Purge). Missing creds => warn and exit 0 (never fail a
// deploy over a purge; the content is already live, just cached).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ZONE_NAME = 'chiptunes.app';

function loadToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const envPath = path.join(os.homedir(), '.config', 'stack', 'cloudflare.env');
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?(CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*=\s*(.+?)\s*$/);
      if (m) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
}

async function main() {
  const token = loadToken();
  if (!token) { console.warn('[purge-cache] no CLOUDFLARE_API_TOKEN — skipping purge (content is live, just edge-cached)'); return; }
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const zr = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}`, { headers: h }).then(r => r.json());
  const zone = zr?.result?.[0]?.id;
  if (!zone) { console.warn('[purge-cache] could not resolve zone for', ZONE_NAME, '- skipping:', JSON.stringify(zr?.errors || zr)); return; }

  const pr = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: 'POST', headers: h, body: JSON.stringify({ purge_everything: true }),
  }).then(r => r.json());
  if (pr?.success) console.log(`[purge-cache] purged ${ZONE_NAME} edge cache ✓`);
  else console.warn('[purge-cache] purge failed (non-fatal):', JSON.stringify(pr?.errors || pr));
}

main().catch(e => { console.warn('[purge-cache] error (non-fatal):', e?.message); });
