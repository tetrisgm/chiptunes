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
  await page.locator('#musicworkspace:not([hidden])').waitFor({ state: 'visible' });
}

async function unifiedCreate(page, name) {
  const root=page.locator('#musicworkspace');
  await root.locator('.cm-content').waitFor({state:'visible'});
  await inViewport(root.locator('[data-action=listen]'),page,`${name}: explicit Listen`);
  // The phone chat drawer may cover composition. Collapse via its public toggle.
  const toggle=root.locator('[data-action=toggle-chat]');
  if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
  for(const action of ['play','pause','stop','apply'])
    await inViewport(root.locator(`[data-action=${action}]`),page,`${name}: unified ${action}`);
  // Short screens intentionally scroll the composition pane rather than shrink
  // code below its readable minimum. Both regions must remain reachable.
  const short=page.viewportSize().height<650;
  await inViewport(root.getByRole('region',{name:'Note chart',exact:true}),page,`${name}: chart`,short);
  await inViewport(root.getByRole('region',{name:'Code editor',exact:true}),page,`${name}: code`,short);
  assert(await root.locator('.mw-note').count()>0,`${name}: starter notes render`);
  const splitter=root.getByRole('separator',{name:'Resize chart and code'});
  const before=Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.focus();await page.keyboard.press('ArrowDown');
  assert.notEqual(Number(await splitter.getAttribute('aria-valuenow')),before,`${name}: keyboard resizes composition`);
  await toggle.click();
  const input=root.locator('.mcui textarea');await input.waitFor({state:'visible'});
  await input.fill('A draft retained across collapse');
  await inViewport(input,page,`${name}: chat composer`);
  await toggle.click();await toggle.click();
  assert.equal(await input.inputValue(),'A draft retained across collapse');
  await toggle.click();
  await root.locator('[data-action=play]').click();
  await page.waitForFunction(()=>document.querySelector('.mw-loop').disabled);
  await root.locator('[data-action=stop]').click();
  await page.waitForFunction(()=>!document.querySelector('.mw-loop').disabled);
  await page.screenshot({path:path.join(screenshots,`${name}-unified-create.png`)});
  await root.locator('[data-action=listen]').click();
  await root.waitFor({state:'hidden'});
}

async function legacyCreate(page, name, mobile) {
  // Explicit compatibility fixture: legacy grid/mood/export controls remain
  // covered, but are no longer expected behind the default Create entry.
  await page.evaluate(()=>CT_CREATE.open());
  await page.locator('#createscreen.show').waitFor({state:'visible'});
  await page.waitForFunction(()=>Math.abs(document.querySelector('#createscreen').getBoundingClientRect().bottom-innerHeight)<1);
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
        await page.goto(`http://127.0.0.1:${host.port}/listen`, { waitUntil: 'domcontentloaded' });
        await landing(page, spec.name);
        await unifiedCreate(page, spec.name);
        await legacyCreate(page, spec.name, spec.viewport.width<760);
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
