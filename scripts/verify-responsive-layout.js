'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium, devices } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-responsive-'));
const MIME = {
  '.css': 'text/css', '.gif': 'image/gif', '.html': 'text/html', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.json': 'application/json',
  '.map': 'application/json', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

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

const cases = [
  { name: 'desktop-1280x900', viewport: { width: 1280, height: 900 } },
  { name: 'desktop-900x650', viewport: { width: 900, height: 650 } },
  { name: 'desktop-narrow-390x844', viewport: { width: 390, height: 844 } },
  { name: 'small-320x568', viewport: { width: 320, height: 568 } },
  { name: 'iphone13-390x844', ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }
];

async function rect(locator) {
  const b=await locator.boundingBox();
  return b && {...b,left:b.x,right:b.x+b.width,top:b.y,bottom:b.y+b.height};
}

async function inViewport(locator, page, label, allowScroll = false) {
  if (allowScroll) await locator.scrollIntoViewIfNeeded();
  const box = await rect(locator);
  assert(box && box.width > 0 && box.height > 0, `${label} has a visible rectangle`);
  const view = page.viewportSize();
  assert(box.left >= -1 && box.right <= view.width + 1 && box.top >= -1 && box.bottom <= view.height + 1,
    `${label} is inside the viewport`);
}

async function landing(page, name) {
  const hero = page.locator('#rmoods').first();
  await hero.waitFor({ state: 'visible' });
  // The startup overlay briefly covers the already-built hero. Do not send
  // the first wheel event to that retiring overlay instead of the landing.
  await page.locator('#intro').waitFor({state:'hidden'});
  await page.evaluate(() => document.fonts.ready);
  const heroBox = await rect(hero);
  const view = page.viewportSize();
  assert(heroBox && heroBox.left >= -1 && heroBox.right <= view.width + 1, `${name}: landing hero fits horizontally`);
  const title = page.locator('#rmoods .rmood-title');
  const titleBox = await rect(title);
  assert(titleBox && titleBox.left >= -1 && titleBox.right <= view.width + 1 && titleBox.top >= -1,
    `${name}: landing title box is not clipped at the top or sides`);
  await page.screenshot({ path: path.join(screenshots, `${name}-landing.png`), fullPage: false });

  const make=page.getByRole('button',{name:'Make it',exact:true});
  const makeBox=await rect(make);
  if(makeBox.bottom>view.height) {
    await page.bringToFront();
    await page.mouse.move(view.width/2,view.height/2);
    await page.mouse.wheel(0,1000);
    await page.waitForTimeout(700);
    await inViewport(make,page,`${name}: primary action revealed by wheel input`);
    await page.screenshot({path:path.join(screenshots,`${name}-landing-scrolled.png`)});
  }
  await make.click();
  assert(await page.getByLabel('Describe the music you want').evaluate(e=>e===document.activeElement),
    `${name}: visible empty-submit action focuses its input`);

  const start = page.getByRole('button', { name: 'Start from scratch', exact: true });
  await start.scrollIntoViewIfNeeded();
  await start.click();
  await page.locator('#createscreen.show').waitFor({ state: 'visible' });
  await page.waitForFunction(()=>Math.abs(document.querySelector('#createscreen').getBoundingClientRect().bottom-innerHeight)<1);
}

async function create(page, name, mobile) {
  const root = page.locator('#createscreen');
  const close = root.getByRole('button', { name: 'Close the editor' });
  await inViewport(close, page, `${name}: close button`);

  for (const [selector, label] of [
    ['[data-cr="rewind"]', 'rewind'], ['[data-cr="play"]', 'play'], ['[data-cr="follow"]', 'follow'],
    ['input[type="range"][data-cr="bpm"]', 'speed slider'], ['[data-cr="grid16"]', 'grid 16'],
    ['[data-cr="grid24"]', 'grid 24'], ['[data-cr="grid32"]', 'grid 32']
  ]) await inViewport(root.locator(selector), page, `${name}: ${label}`);

  const moods = root.locator('.n-moodrow');
  const utils = root.locator('.n-utils');
  const moodBox = await rect(moods);
  const closeBox = await rect(close);
  assert(moodBox && closeBox && moodBox.right <= closeBox.left + 1, `${name}: mood viewport ends before close button`);

  const input = root.getByLabel('Describe your song');
  await input.fill('A dreamy cave theme in D minor, no drums');
  await root.getByRole('button', { name: 'Write song', exact: true }).click();
  const status = root.locator('.n-prompt-result[role="status"]');
  await status.waitFor({ state: 'visible', timeout: 30000 });
  await root.locator('.n-note').first().waitFor({state:'visible',timeout:30000});
  assert((await status.textContent()).trim().length > 0, `${name}: interpretation status is populated`);
  assert(await root.locator('.n-note').count() > 0, `${name}: generated notes render`);

  if (mobile) {
    await utils.hover();
    await page.mouse.wheel(700, 0);
    await page.keyboard.press('Tab');
    const midi = root.getByRole('button', { name: 'Download MIDI', exact: true });
    await midi.scrollIntoViewIfNeeded();
    await midi.focus();
    assert(await midi.isVisible(), `${name}: Download MIDI is reachable after wheel/keyboard reveal`);
    const midiBox = await rect(midi);
    const utilsBox = await rect(utils);
    assert(midiBox && utilsBox && midiBox.left >= utilsBox.left - 1 && midiBox.right <= utilsBox.right + 1,
      `${name}: Download MIDI is visible inside the utility clip`);
  }

  await page.screenshot({ path: path.join(screenshots, `${name}-create.png`), fullPage: false });
  const play = root.locator('[data-cr="play"]');
  const before=await play.getAttribute('aria-pressed');
  await play.click();
  assert.notStrictEqual(await play.getAttribute('aria-pressed'),before,`${name}: transport reports changed playback state`);
  await play.click();
  assert.strictEqual(await play.getAttribute('aria-pressed'),before,`${name}: transport restores playback state`);
  await close.click();
  await page.locator('#createscreen.show').waitFor({ state: 'hidden' });
  // Close returns to the prior station/landing context; it is not an implicit
  // 'publish this edit to the player' action. Start the player explicitly.
  await page.locator('#rmoods [data-mood="happy"]').click();
  await page.waitForFunction(()=>!document.body.classList.contains('awaiting-mood'));
  await page.waitForTimeout(350);
  await page.mouse.move(page.viewportSize().width/2,page.viewportSize().height/2);
  await inViewport(page.locator('#pbPlay'),page,`${name}: player play control after Create closes`);
  await page.screenshot({path:path.join(screenshots,`${name}-player.png`)});
}

(async () => {
  let host;
  let browser;
  const errors = [];
  try {
    host = await serve();
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    for (const spec of cases) {
      const context = await browser.newContext({ ...spec, viewport: spec.viewport, deviceScaleFactor: spec.deviceScaleFactor || 1 });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      try {
        await page.goto(`http://127.0.0.1:${host.port}/`, { waitUntil: 'domcontentloaded' });
        await landing(page, spec.name);
        await create(page, spec.name, spec.viewport.width<760);
        assert.equal(pageErrors.length, 0, `${spec.name}: no page errors (${pageErrors.join('; ')})`);
        console.log(`ok ${spec.name}`);
      } catch (error) {
        await page.screenshot({path:path.join(screenshots,`${spec.name}-failure.png`)}).catch(()=>{});
        errors.push(`${spec.name}: ${error.message}`);
      } finally {
        await page.close();
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    if (host) await new Promise(resolve => host.server.close(resolve));
  }
  console.log(`screenshots: ${screenshots}`);
  if (errors.length) { errors.forEach(error => console.error(`FAIL ${error}`)); process.exitCode = 1; }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
