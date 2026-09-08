// MOCKED ClerkJS/DOM unit tests: no real Clerk instance or refresh is claimed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAuth, browserAuthResponse } from '../lib/clerk-browser.mjs';

const config = { publishableKey: 'pk_test_mock_only', origin: 'https://music.example',
  scriptUrl: 'https://clerk.example/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js' };
function fixture() {
  let loads = 0, requests = 0, clock = 0, expires = -1, cached;
  const session = { id: 'sess_test', getToken: async () => {
    requests++;
    if (clock >= expires) { cached = `mock_token_at_${clock}`; expires = clock + 60; }
    return cached;
  } };
  const browser = { setTimeout, clearTimeout, location: { origin: config.origin }, Clerk: {
    publishableKey: config.publishableKey, session,
    load: async () => { loads++; },
  } };
  return { browser, auth: createBrowserAuth(config, browser), advance: seconds => { clock += seconds; },
    counts: () => ({ loads, requests }) };
}

test('MOCKED ClerkJS: module import and missing config do not contact Clerk or block editor', async () => {
  const response = browserAuthResponse(null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  const source = await response.text();
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  await assert.rejects(() => module.ready(), /unconfigured/);
  await assert.rejects(() => module.getSessionToken(), /unconfigured/);
});

test('public bootstrap never serializes secret config; ClerkJS is pinned', async () => {
  const response = browserAuthResponse({ publishableKey: config.publishableKey, issuer: 'https://clerk.example',
    resource: `${config.origin}/api/mcp`, secretKey: 'SENSITIVE_SENTINEL', extra: 'PRIVATE_SENTINEL' });
  const source = await response.text();
  assert.ok(source.includes('@clerk/clerk-js@6.31.0/'));
  assert.ok(source.includes(config.publishableKey));
  assert.ok(!source.includes('SENSITIVE_SENTINEL'));
  assert.ok(!source.includes('PRIVATE_SENTINEL'));
});

test('MOCKED ClerkJS: each request asks SDK for token across 60 seconds and long tab suspension', async () => {
  const f = fixture();
  await Promise.all([f.auth.ready(), f.auth.ready()]);
  assert.equal(await f.auth.getSessionToken(), 'mock_token_at_0');
  f.advance(30);
  assert.equal(await f.auth.getSessionToken(), 'mock_token_at_0');
  f.advance(31);
  assert.equal(await f.auth.getSessionToken(), 'mock_token_at_61');
  f.advance(3600);
  assert.equal(await f.auth.getSessionToken(), 'mock_token_at_3661');
  assert.deepEqual(f.counts(), { loads: 1, requests: 4 });
});

test('MOCKED ClerkJS: logout, session switch, null token and refresh failure never reuse a token', async () => {
  for (const behavior of ['logout', 'switch', 'null', 'failure']) {
    const f = fixture();
    await f.auth.getSessionToken();
    if (behavior === 'logout') f.browser.Clerk.session = null;
    else f.browser.Clerk.session.getToken = async () => {
      if (behavior === 'failure') throw Error('sensitive upstream details');
      if (behavior === 'switch') f.browser.Clerk.session = { id: 'sess_other' };
      return behavior === 'null' ? null : 'old_token';
    };
    await assert.rejects(() => f.auth.getSessionToken(),
      behavior === 'failure' ? /unavailable/ : /signed-out/);
  }
});

test('MOCKED DOM: lazy SDK script uses only trusted config and initializes once', async () => {
  const f = fixture();
  const sdk = f.browser.Clerk;
  delete f.browser.Clerk;
  let appended = 0;
  Object.assign(f.browser, { setTimeout, clearTimeout, document: {
    createElement: () => ({ setAttribute(name, value) { this[name] = value; }, remove() {} }),
    head: { appendChild(script) {
      appended++;
      assert.equal(script.src, config.scriptUrl);
      assert.equal(script['data-clerk-publishable-key'], config.publishableKey);
      f.browser.Clerk = sdk;
      queueMicrotask(() => script.onload());
    } },
  } });
  assert.equal(appended, 0);
  await Promise.all([f.auth.ready(), f.auth.ready()]);
  assert.equal(appended, 1);
  assert.equal(await f.auth.getSessionToken(), 'mock_token_at_0');
});

test('MOCKED ClerkJS: wrong origin and wrong existing instance fail closed', async () => {
  const f = fixture();
  f.browser.location.origin = 'https://other.example';
  await assert.rejects(() => f.auth.ready(), /unavailable/);
  f.browser.location.origin = config.origin;
  f.browser.Clerk.publishableKey = 'pk_test_other';
  await assert.rejects(() => f.auth.ready(), /unavailable/);
});

test('MOCKED ClerkJS: stalled initialization is bounded and a later explicit attempt can retry', async () => {
  const f = fixture();
  f.browser.Clerk.load = () => new Promise(() => {});
  f.browser.setTimeout = callback => setTimeout(callback, 1);
  await assert.rejects(() => f.auth.ready(), /unavailable/);
  f.browser.Clerk.load = async () => {};
  assert.equal(await f.auth.getSessionToken(), 'mock_token_at_0');
});
