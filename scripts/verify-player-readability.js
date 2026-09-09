'use strict';

// PLAYER READABILITY GATE. The 2026-09-05 review noted the station player
// "crowd/truncate its duration label near the volume area" at 1280px. The
// first cut of this script measured #pbVolume -- a HIDDEN legacy button
// (display:none via shell.html) -- so it missed the real defect. The VISIBLE
// volume control is .pb-voldial (a pill whose "VOL" is a ::before and whose
// slider is #pbVol). This gate measures the total-time label (#pbTotal) against
// that visible dial.
//
// Three things are checked, across desktop widths and against a live browser:
//   A) Player: #pbTotal does not overlap .pb-voldial, keeps a small clearance,
//      and is not clipped (scrollWidth <= clientWidth).
//   B) Phone prompt: a long brief (many traits + unsupported words) keeps the
//      transport on-screen, bounds the primary reading, and exposes the full
//      caveats through a disclosure reachable by keyboard AND click.
//   C) Escape retains cold composition without autoplaying any player.
//
// It writes a screenshot per case so the VISIBLE confirmation can be done by
// eye; the script gates the geometry, it is not the visible check.
// Run after building dist:  node scripts/verify-player-readability.js

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-player-read-'));
const MIN_GAP = 6;                 // px of clearance between duration and dial
const MIME = {
  '.css': 'text/css', '.gif': 'image/gif', '.html': 'text/html', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.json': 'application/json',
  '.map': 'application/json', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Widths around the reported 1280, including 1200 (just above the 1180 slider
// drop) and wider desks where the centre panel is at its cap.
const WIDTHS = [1280, 1200, 1440, 1600];

function serve() {
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { res.writeHead(400); return res.end(); }
    let file = path.resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${path.resolve(DIST)}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(500); return res.end(String(err)); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

async function rect(locator) {
  const b = await locator.boundingBox();
  return b && { ...b, left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
}

function intersects(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

async function inViewport(locator, page, label) {
  const box = await rect(locator);
  const view = page.viewportSize();
  assert(box && box.width > 0 && box.height > 0, `${label}: has a visible rectangle`);
  assert(box.top >= -1 && box.bottom <= view.height + 1, `${label}: is inside the viewport`);
}

async function openCreateFromLanding(page, legacy = false) {
  // The startup overlay briefly covers the built landing; wait it out or the
  // first click lands on a retiring overlay.
  await page.locator('#intro').waitFor({ state: 'hidden' }).catch(() => {});
  await page.locator('#rmoods').first().waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  if (legacy) {
    // Explicit legacy prompt compatibility: preserve the disclosure/readability
    // assertions without claiming this is the default unified Create surface.
    await page.evaluate(() => CT_CREATE.open());
    await page.locator('#createscreen.show').waitFor({state:'visible'});
    return;
  }
  const make = page.getByRole('button', { name: 'Make it', exact: true });
  if (await make.count()) { await make.scrollIntoViewIfNeeded(); await make.click(); }
  const start = page.getByRole('button', { name: 'Start from scratch', exact: true });
  await start.scrollIntoViewIfNeeded();
  await start.click();
  await page.locator('#musicworkspace:not([hidden])').waitFor({ state: 'visible' });
}

// ---- A) player: duration vs the VISIBLE volume dial -----------------------
async function playerCase(page, name) {
  await page.locator('#intro').waitFor({ state: 'hidden' }).catch(() => {});
  await page.locator('#rmoods').first().waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#rmoods [data-mood="happy"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('awaiting-mood'));
  await page.locator('#playbar.show').waitFor({ state: 'visible' });
  // #pbTotal only exists once the note ribbon is on (a score is playing).
  await page.waitForFunction(() => document.body.classList.contains('ribbon-on'), null, { timeout: 15000 });
  // Controls fade on idle; a pointer poke brings the bar in for a clean read.
  const view = page.viewportSize();
  await page.mouse.move(view.width / 2, view.height / 2);
  await page.waitForTimeout(350);

  const geo = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
               width: r.width, height: r.height,
               scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    };
    return { total: box(document.querySelector('#pbTotal')),
             dial: box(document.querySelector('#playbar .pb-right .pb-voldial')) };
  });
  const { total, dial } = geo;
  await page.screenshot({ path: path.join(screenshots, `${name}-player.png`), fullPage: false });
  assert(total && total.width > 0 && total.height > 0, `${name}: duration label (#pbTotal) has a visible rectangle`);
  assert(dial && dial.width > 0 && dial.height > 0, `${name}: visible volume dial (.pb-voldial) has a visible rectangle`);
  assert(!intersects(total, dial), `${name}: duration label does not overlap the volume dial`);
  const shareBand = total.top < dial.bottom && dial.top < total.bottom;
  if (shareBand) {
    const gap = dial.left - total.right;
    assert(gap >= MIN_GAP, `${name}: duration keeps >= ${MIN_GAP}px clearance from the volume dial (got ${gap.toFixed(1)}px)`);
  }
  assert(total.scrollWidth <= total.clientWidth + 1,
    `${name}: duration label is not clipped (scrollWidth ${total.scrollWidth} <= clientWidth ${total.clientWidth})`);
}

// ---- B) phone: a long brief must not push the transport off-screen ---------
async function phonePromptCase(page) {
  const name = 'phone-prompt-390x844';
  await openCreateFromLanding(page, true);
  const root = page.locator('#createscreen');
  const input = root.getByLabel('Describe your song');
  await input.fill('A happy, upbeat, dreamy, epic, retro, funky battle theme in D minor at 150 bpm, with heavy reverb, sidechain compression and a saxophone solo, no drums');
  await root.getByRole('button', { name: 'Write song', exact: true }).click();
  const status = root.locator('.n-prompt-result[role="status"]');
  await status.waitFor({ state: 'visible', timeout: 30000 });
  await root.locator('.n-note').first().waitFor({ state: 'visible', timeout: 30000 });

  const play = root.locator('[data-cr="play"]');
  await inViewport(play, page, `${name}: transport after a long brief (disclosure closed)`);

  const primaryBox = await rect(root.locator('.npr-primary'));
  assert(primaryBox && primaryBox.height <= 46,
    `${name}: primary reading is bounded to ~2 lines (got ${primaryBox && primaryBox.height}px)`);

  const more = root.locator('.npr-more');
  assert(await more.count() === 1, `${name}: a caveat disclosure is present for a long brief`);

  // Reachable by keyboard...
  const summary = root.locator('.npr-more > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  assert(await more.evaluate(d => d.open), `${name}: disclosure opens with the keyboard`);
  const detail = root.locator('.npr-detail');
  assert((await detail.textContent()).trim().length > 0, `${name}: full caveats are reachable`);
  await inViewport(play, page, `${name}: transport still on-screen with the disclosure open`);

  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: false });

  // ...and toggled by click.
  await summary.click();
  assert(!(await more.evaluate(d => d.open)), `${name}: disclosure toggles closed with a click`);
}

// ---- C) Escape retains primary composition, no autoplay -------------------
async function coldEscapeCase(page) {
  const name = 'cold-escape-1280x900';
  await openCreateFromLanding(page);
  const root = page.locator('#musicworkspace');
  await root.locator('.cm-content').focus();
  await page.keyboard.press('Escape');
  assert(await root.isVisible(), `${name}: Escape retains the primary composition`);
  for (const selector of ['.mw-code', '.mw-notes', '.mw-stage-viewport'])
    assert(await root.locator(selector).isVisible(), `${name}: ${selector} remains visible`);
  const silent = await page.evaluate(async () => {
    let peak=0;
    for(let i=0;i<10;i++){peak=Math.max(peak,Audio.outputProbe().peak);await new Promise(resolve=>setTimeout(resolve,100));}
    const state=CT_MUSIC_WORKSPACE.snapshot();
    return peak<.02 && !state.playing && !state.pending;
  });
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: false });
  const playerShown = await page.locator('#playbar.show').isVisible().catch(() => false);
  assert(!playerShown && silent, `${name}: Escape starts neither composition nor station playback`);
}

(async () => {
  let host;
  let browser;
  const errors = [];
  const run = async (label, viewport, fn) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    try {
      await page.goto(`http://127.0.0.1:${host.port}/listen`, { waitUntil: 'domcontentloaded' });
      await fn(page);
      assert.equal(pageErrors.length, 0, `${label}: no page errors (${pageErrors.join('; ')})`);
      console.log(`ok ${label}`);
    } catch (error) {
      await page.screenshot({ path: path.join(screenshots, `${label}-failure.png`) }).catch(() => {});
      errors.push(`${label}: ${error.message}`);
    } finally {
      await page.close();
      await context.close();
    }
  };
  try {
    host = await serve();
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    for (const width of WIDTHS) {
      await run(`player-${width}`, { width, height: 900 }, (page) => playerCase(page, `player-${width}`));
    }
    await run('phone-prompt-390x844', { width: 390, height: 844 }, phonePromptCase);
    await run('cold-escape-1280x900', { width: 1280, height: 900 }, coldEscapeCase);
  } finally {
    if (browser) await browser.close();
    if (host) await new Promise(resolve => host.server.close(resolve));
  }
  console.log(`screenshots: ${screenshots}`);
  if (errors.length) { errors.forEach(error => console.error(`FAIL ${error}`)); process.exitCode = 1; }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
