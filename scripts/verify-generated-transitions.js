// The two ways back into a private generated station must mint exactly one
// fresh token. This guards the real router and desktop bridge paths: a former
// selector helper was removed when generation became single-path, but these
// callers were left behind and crashed only after the player had booted.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');

function startServer(){
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
      let file = path.join(DIST, rel || 'index.html');
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
        file = path.join(DIST, 'index.html');
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, {
          'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html',
          'cache-control': 'no-store'
        });
        res.end(body);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}`
    }));
  });
}

function assert(condition, message){
  if (!condition) throw new Error(message);
  console.log('  ok   ' + message);
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html')))
    throw new Error('dist is missing; run node build.js first');

  const { server, url } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));

    // /radio is a supported cold entry. It must wait for an explicit choice,
    // not mint and discard a song while rewriting the route to itself.
    await page.goto(url + '/radio', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof Audio !== 'undefined' && Audio.isHolding && Audio.isHolding());
    const cold = await page.evaluate(() => ({
      holding: Audio.isHolding(),
      token: Audio.trackToken ? Audio.trackToken() : '',
      path: location.pathname
    }));
    assert(cold.holding && !cold.token, 'cold /radio holds without minting a track');
    assert(cold.path === '/' || cold.path === '/radio',
      'cold /radio stays on a player route without inventing a track URL');

    // Exercise the public router after boot. Private intent must mint directly;
    // live schedule and queue policy are not allowed to substitute a token.
    const routed = await page.evaluate(async () => {
      const calls = [];
      const original = {
        mint: Song.mint,
        gotoTrack: Audio.gotoTrack,
        liveActive: LiveCtl.active,
        liveNext: LiveCtl.nextToken
      };
      try {
        Radio.setLive(false);
        Song.mint = () => 'private-route-token';
        LiveCtl.active = () => true;
        LiveCtl.nextToken = () => { calls.push('live-policy'); return 'scheduled-token'; };
        Audio.gotoTrack = token => { calls.push(token); };
        history.pushState(null, '', '/');
        dispatchEvent(new PopStateEvent('popstate'));
        await new Promise(resolve => setTimeout(resolve, 50));
        return { calls, live: Radio.live(), path: location.pathname };
      } finally {
        Song.mint = original.mint;
        Audio.gotoTrack = original.gotoTrack;
        LiveCtl.active = original.liveActive;
        LiveCtl.nextToken = original.liveNext;
      }
    });
    assert(!routed.live, 'private route remains outside the live schedule');
    assert(routed.calls.length === 1 && routed.calls[0] === 'private-route-token',
      'already-booted private route mints one fresh token');

    // Exercise the desktop bridge path used when system-audio capture is
    // disabled or ends. It also requires a direct fresh token rather than the
    // broadcast schedule or playback queue.
    const returned = await page.evaluate(async () => {
      const calls = [];
      const original = {
        mint: Song.mint,
        extActive: Audio.extActive,
        stopExternal: Audio.stopExternal,
        gotoTrack: Audio.gotoTrack,
        liveActive: LiveCtl.active,
        liveNext: LiveCtl.nextToken
      };
      try {
        Song.mint = () => 'external-return-token';
        Audio.extActive = () => true;
        Audio.stopExternal = () => { calls.push('stopped'); };
        Audio.gotoTrack = token => { calls.push(token); };
        LiveCtl.active = () => true;
        LiveCtl.nextToken = () => { calls.push('live-policy'); return 'scheduled-token'; };
        const ok = await RRR.setSystemAudio(false);
        return { calls, ok };
      } finally {
        Song.mint = original.mint;
        Audio.extActive = original.extActive;
        Audio.stopExternal = original.stopExternal;
        Audio.gotoTrack = original.gotoTrack;
        LiveCtl.active = original.liveActive;
        LiveCtl.nextToken = original.liveNext;
      }
    });
    assert(returned.ok === true, 'desktop bridge accepts system-audio shutdown');
    assert(returned.calls.join(',') === 'stopped,external-return-token',
      'external return stops capture and mints one fresh token');
    assert(!errors.length, 'generated transitions raise no page errors');
    assert(!fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime.js'), 'utf8').includes('_nextGeneratedToken'),
      'removed selector has no remaining runtime callers');

    console.log('\nverify-generated-transitions: private entry and external return are safe');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error('verify-generated-transitions FAILED:', error.stack || error);
  process.exitCode = 1;
});
