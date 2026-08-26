#!/usr/bin/env node
// Publish Chiptunes' signed macOS update to R2. The versioned ZIP is immutable and always lands
// before latest-mac.yml; replacing the feed is the only public version flip.

import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'desktop');
const pkg = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
const version = pkg.version;
const bucket = process.env.RRR_UPDATE_BUCKET || 'chiptunes-updates';
const baseUrl = (process.env.RRR_UPDATES_BASE_URL || 'https://updates.chiptunes.app').replace(/\/$/, '');
const uploadTimeoutMs = Number(process.env.RRR_UPDATE_UPLOAD_TIMEOUT_MS || 600_000);
const verifyTimeoutMs = Number(process.env.RRR_UPDATE_VERIFY_TIMEOUT_MS || 60_000);
const artifactName = `Chiptunes-${version}-arm64.zip`;
const zipPath = path.join(desktop, 'dist', artifactName);
const feedPath = path.join(desktop, 'dist', 'latest-mac.yml');

if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  throw new Error(`Invalid desktop version: ${version}`);
}
if (!Number.isSafeInteger(uploadTimeoutMs) || uploadTimeoutMs < 1_000
    || !Number.isSafeInteger(verifyTimeoutMs) || verifyTimeoutMs < 1_000) {
  throw new Error('Invalid update publish timeout');
}

const [zip, feed] = await Promise.all([readFile(zipPath), readFile(feedPath, 'utf8')]);
const expectedSha512 = createHash('sha512').update(zip).digest('base64');
const feedVersion = feed.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
const feedSha512 = feed.match(/^sha512:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];

if (feedVersion !== version) throw new Error(`latest-mac.yml advertises ${feedVersion}, expected ${version}`);
if (!feed.includes(`url: ${artifactName}`) && !feed.includes(`path: ${artifactName}`)) {
  throw new Error(`latest-mac.yml does not reference ${artifactName}`);
}
if (feedSha512 !== expectedSha512) throw new Error('latest-mac.yml sha512 does not match the ZIP');

async function executable(file) {
  try { await access(file, fsConstants.X_OK); return true; }
  catch { return false; }
}

const configuredWrangler = process.env.RRR_WRANGLER_BIN;
const localWrangler = path.join(root, 'cloudflare', 'node_modules', '.bin', 'wrangler');
const wrangler = configuredWrangler
  ? { command: configuredWrangler, prefix: [] }
  : await executable(localWrangler)
    ? { command: localWrangler, prefix: [] }
    : { command: 'npx', prefix: ['--yes', 'wrangler@4'] };

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(wrangler.command, [...wrangler.prefix, ...args], {
      cwd: root,
      env: process.env,
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let done = false;
    let timedOut = false;
    let killTimer;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(killTimer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5_000);
    }, uploadTimeoutMs);
    child.once('error', finish);
    child.once('exit', (code, signal) => {
      if (timedOut) finish(new Error(`wrangler timed out after ${uploadTimeoutMs}ms`));
      else if (code === 0) finish();
      else finish(new Error(`wrangler exited ${signal || code}`));
    });
  });
}

async function fetchCapped(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), verifyTimeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function retry(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await operation(); return; }
    catch (error) {
      lastError = error;
      console.error(`\n*** UPDATE PUBLISH ERROR: ${label} failed (attempt ${attempt}/3) ***`);
      console.error(error && error.stack || error);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
  throw lastError;
}

console.log(`[updates] publishing Chiptunes v${version} to ${bucket}`);
await retry('ZIP upload', () => runWrangler([
  'r2', 'object', 'put', `${bucket}/${artifactName}`,
  '--file', zipPath,
  '--content-type', 'application/zip',
  '--cache-control', 'public, max-age=31536000, immutable',
  '--remote',
]));
// Stable download alias for the website's "Download" button (updates.chiptunes.app/Chiptunes-mac.zip).
// Short cache + must-revalidate so it always points at the newest release; the versioned ZIP above
// stays immutable for electron-updater.
await retry('stable ZIP alias', () => runWrangler([
  'r2', 'object', 'put', `${bucket}/Chiptunes-mac.zip`,
  '--file', zipPath,
  '--content-type', 'application/zip',
  '--cache-control', 'public, max-age=0, must-revalidate',
  '--remote',
]));
await retry('feed upload', () => runWrangler([
  'r2', 'object', 'put', `${bucket}/latest-mac.yml`,
  '--file', feedPath,
  '--content-type', 'application/yaml; charset=utf-8',
  '--cache-control', 'no-store, max-age=0',
  '--remote',
]));

async function verifyPublicFeed() {
  const response = await fetchCapped(`${baseUrl}/latest-mac.yml?verify=${encodeURIComponent(version)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`public feed returned HTTP ${response.status}`);
  const publicFeed = await response.text();
  if (!publicFeed.includes(`version: ${version}`) || !publicFeed.includes(`url: ${artifactName}`)
      || !publicFeed.includes(`sha512: ${expectedSha512}`)) {
    throw new Error('public feed does not match the uploaded release');
  }
  const zipResponse = await fetchCapped(`${baseUrl}/${artifactName}`, { method: 'HEAD', cache: 'no-store' });
  if (!zipResponse.ok) throw new Error(`public ZIP returned HTTP ${zipResponse.status}`);
  const localSize = (await stat(zipPath)).size;
  const publicSize = Number(zipResponse.headers.get('content-length'));
  if (publicSize !== localSize) throw new Error(`public ZIP size ${publicSize} does not match ${localSize}`);
}

await retry('public verification', verifyPublicFeed);
console.log(`[updates] live: ${baseUrl}/latest-mac.yml -> ${artifactName}`);
