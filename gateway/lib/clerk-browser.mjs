// Browser-only implementation, serialized by /api/auth. Keep this function
// self-contained: no server imports or secrets can enter the emitted module.
export function createBrowserAuth(config, browser = globalThis) {
  let loading;
  function ready() {
    if (!config) return Promise.reject(new Error('unconfigured'));
    if (browser.location.origin !== config.origin) return Promise.reject(new Error('unavailable'));
    if (!loading) {
      loading = (async () => {
        if (!browser.Clerk) {
          await new Promise((resolve, reject) => {
            const script = browser.document.createElement('script');
            const timeout = browser.setTimeout(() => finish(false), 10000);
            function finish(ok) {
              browser.clearTimeout(timeout);
              script.onload = script.onerror = null;
              if (!ok) script.remove();
              ok ? resolve() : reject(new Error('unavailable'));
            }
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.src = config.scriptUrl;
            script.setAttribute('data-clerk-publishable-key', config.publishableKey);
            script.onload = () => finish(true);
            script.onerror = () => finish(false);
            browser.document.head.appendChild(script);
          });
        }
        if (!browser.Clerk || browser.Clerk.publishableKey !== config.publishableKey) throw new Error('unavailable');
        // ClerkJS owns session maintenance. No UI is mounted and no redirect is
        // requested. getToken below also refreshes after a suspended/background tab.
        let timeout;
        try {
          await Promise.race([
            browser.Clerk.load({ signInUrl: '/sign-in' }),
            new Promise((_, reject) => {
              timeout = browser.setTimeout(() => reject(new Error('unavailable')), 10000);
            }),
          ]);
        } finally { browser.clearTimeout(timeout); }
        return browser.Clerk;
      })().catch(() => { loading = undefined; throw new Error('unavailable'); });
    }
    return loading;
  }
  async function getSessionToken() {
    const clerk = await ready();
    const session = clerk.session;
    if (!session) throw new Error('signed-out');
    let token;
    try {
      // Ask on EVERY protected request. Clerk caches only while valid and
      // refreshes through its authenticated Frontend API when necessary.
      token = await session.getToken();
    } catch { throw new Error('unavailable'); }
    if (typeof token !== 'string' || !token || clerk.session?.id !== session.id) throw new Error('signed-out');
    return token;
  }
  return Object.freeze({ ready, getSessionToken });
}

export function browserAuthResponse(config) {
  // Explicit public allowlist. Never serialize the server config object.
  const publicConfig = config ? {
    publishableKey: config.publishableKey,
    origin: new URL(config.resource).origin,
    scriptUrl: `${config.issuer}/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js`,
  } : null;
  const source = `const auth = (${createBrowserAuth.toString()})(${JSON.stringify(publicConfig)});\n` +
    'export const ready = auth.ready;\nexport const getSessionToken = auth.getSessionToken;\n';
  return new Response(source, { headers: {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  } });
}
