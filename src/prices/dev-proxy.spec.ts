import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import viteConfig, { devProxy } from '../../vite.config.ts';

/**
 * The dev proxy carries this app's one security property and had no coverage:
 * the API key is read in the Node config and injected server-side, per path, so
 * it never reaches the bundle. A refactor that moved it into `define`, or into a
 * `VITE_`-prefixed variable, would compile a credential into the JavaScript
 * served to every visitor and no test would have noticed.
 *
 * `loadEnv(mode, dir, '')` reads `process.env` as well as the `.env` files, which
 * is what lets these tests set a target without writing one to disk.
 *
 * From stellar-prices-api 7d9e9e70 `web/portal/src/dev-proxy.spec.ts`, against
 * this repo's `vite.config.ts`, whose `devProxy` is the source's proxy.
 */
type ProxyEntry = {
  target?: string;
  changeOrigin?: boolean;
  secure?: boolean;
  headers?: Record<string, string>;
};
type ResolvedConfig = {
  server?: { proxy?: Record<string, ProxyEntry> };
  preview?: { proxy?: Record<string, ProxyEntry> };
};

const PROXY_TARGET = 'https://portal.example.invalid';

/**
 * The portal backend's proxy rule is a regex key (the bundle shares `/api/`:
 * `/api/prices-api/` since task 0339, and in this repo `/api/` itself), so look
 * it up by shape rather than by literal.
 */
const backendRule = (proxy: Record<string, ProxyEntry> | undefined) => {
  const key = Object.keys(proxy ?? {}).find((k) => k.startsWith('^/api/'));
  expect(key, 'a regex proxy rule for the portal backend').toBeDefined();
  return { key: key as string, entry: proxy?.[key as string] };
};

const resolve = (): ResolvedConfig => {
  const config =
    typeof viteConfig === 'function'
      ? viteConfig({ command: 'serve', mode: 'development' })
      : viteConfig;
  expect(config).not.toBeInstanceOf(Promise);
  return config as ResolvedConfig;
};

describe('dev proxy', () => {
  beforeEach(() => {
    process.env['DEV_API_PROXY_TARGET'] = PROXY_TARGET;
    process.env['DEV_API_KEY'] = 'test-key-must-not-leak';
  });
  afterEach(() => {
    delete process.env['DEV_API_PROXY_TARGET'];
    delete process.env['DEV_API_KEY'];
  });

  it('proxies the portal backend from both the dev server and preview', () => {
    const { server, preview } = resolve();

    // `preview` is the only local way to run the BUILT bundle, so it is the
    // closest thing to a production rehearsal; without a proxy it could only
    // ever render the "could not reach the portal backend" branch.
    expect(backendRule(server?.proxy).entry?.target).toBe(PROXY_TARGET);
    expect(backendRule(preview?.proxy).entry?.target).toBe(PROXY_TARGET);
    expect(preview?.proxy).toEqual(server?.proxy);
  });

  it('sends the key to /v1 only, never to the portal routes', () => {
    const proxy = resolve().server?.proxy ?? {};

    // A visitor signing in to obtain a key does not have one yet, so keying the
    // portal's own routes in dev would exercise a configuration production never
    // runs — and would hide a 403 that only appears for real users.
    expect(proxy['/v1']?.headers?.['x-api-key']).toBe('test-key-must-not-leak');
    expect(backendRule(proxy).entry?.headers).toBeUndefined();
    expect(proxy['/health']?.headers).toBeUndefined();
    expect(proxy['/api-docs-json']?.headers).toBeUndefined();
  });

  it('proxies the backend segments and leaves the bundle to Vite', () => {
    const { key } = backendRule(resolve().server?.proxy);
    const rule = new RegExp(key);

    for (const backend of [
      '/api/config',
      '/api/auth/login',
      '/api/auth/callback?code=x',
      // A query directly on a segment, with no slash between: the guard used to
      // read `(/|$)`, so `/api/config?…` fell through to Vite and the dev server
      // answered the app's own `index.html` with a `200` — the same silent
      // wrong-`200` shape task 0194 spent a day diagnosing in production.
      '/api/config?fresh=1',
      '/api/usage?window=day',
      '/api/key',
      '/api/key/rework',
      '/api/usage',
      '/api/api-docs-json',
    ]) {
      expect(rule.test(backend), backend).toBe(true);
    }
    // Vite's own dev-server paths and the app's pages share the prefix and
    // must NOT be proxied, or the dev server cannot serve itself.
    for (const bundle of [
      '/api/prices-api/',
      '/api/prices-api/index.html',
      '/api/prices-api/@vite/client',
      '/api/prices-api/src/main.tsx',
      '/api/prices-api/assets/index.js',
      '/api/prices-api/login',
      '/api/prices-api/dashboard',
      // Bundle paths ending in a backend segment's name stay the bundle's.
      '/api/prices-api/config',
      '/api/prices-api/key',
      '/api/keys', // not `/api/key` — the `(/|\?|$)` guard
      '/api/configuration', // and the query arm did not widen it into a prefix match
      // In this repo the bundle is served from `/api/` itself, the hub's pages
      // and Vite's own paths with it, and the Prices pages under it.
      '/api/',
      '/api/index.html',
      '/api/@vite/client',
      '/api/@react-refresh',
      '/api/src/boot.js',
      '/api/src/prices/main.tsx',
      '/api/node_modules/.vite/deps/react.js',
      '/api/assets/index.js',
      '/api/prices-api/openapi.json',
      '/api/login',
      '/api/dashboard',
      '/api/privacy-policy',
      // The shared sign-in's backend, to come at `/api/hub/*`.
      '/api/hub/',
      '/api/hub/auth/login',
    ]) {
      expect(rule.test(bundle), bundle).toBe(false);
    }
  });
});

describe('dev proxy without DEV_API_PROXY_TARGET', () => {
  // Empty in `process.env`, which wins over the `.env` files, so a local
  // `.env.local` or `.env.development` cannot set a target here; the config
  // reads an empty setting as an unset one.
  beforeEach(() => {
    vi.stubEnv('DEV_API_PROXY_TARGET', '');
    vi.stubEnv('DEV_API_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("proxies the portal backend to Prices' production API", () => {
    const { server, preview } = resolve();
    const { key, entry } = backendRule(server?.proxy);

    // `pnpm dev` alone shows the Prices portal as production does:
    // `/api/config` reaches a backend rather than Vite.
    expect(new RegExp(key).test('/api/config'), key).toBe(true);
    expect(entry?.target).toBe('https://prices-api.sorobanscan.com');
    expect(server?.proxy?.['/v1']?.target).toBe(
      'https://prices-api.sorobanscan.com',
    );
    expect(server?.proxy?.['/v1']?.headers).toBeUndefined();
    expect(preview?.proxy).toEqual(server?.proxy);
  });
});

describe('devProxy', () => {
  it('forwards the backend rule, /v1, /health and /api-docs-json to the target', () => {
    const proxy = devProxy(PROXY_TARGET, undefined);

    expect(Object.keys(proxy ?? {})).toEqual([
      '^/api/(auth|key|usage|config|api-docs-json)(/|\\?|$)',
      '/v1',
      '/health',
      '/api-docs-json',
    ]);
    // `changeOrigin` rewrites `Host`, so CloudFront routes to the right
    // distribution.
    for (const entry of Object.values(proxy ?? {})) {
      expect(entry).toEqual({ target: PROXY_TARGET, changeOrigin: true, secure: true });
    }
  });

  it('puts the key on /v1 alone, and nowhere without one', () => {
    const keyed = devProxy(PROXY_TARGET, 'test-key-must-not-leak') ?? {};
    for (const [path, entry] of Object.entries(keyed)) {
      expect(entry.headers, path).toEqual(
        path === '/v1' ? { 'x-api-key': 'test-key-must-not-leak' } : undefined,
      );
    }
  });

  // Tested here and not through the config, as the source's spec explains:
  // `loadEnv` reads `.env.local` and `.env.development` from disk as well as
  // `process.env`, and they are gitignored, so through the config the assertion
  // would depend on
  // whether the machine running it has set up a dev proxy. `devProxy` reads no
  // file.
  it('proxies nothing when no target is set', () => {
    expect(devProxy(undefined, 'test-key-must-not-leak')).toBeUndefined();
    expect(devProxy('', 'test-key-must-not-leak')).toBeUndefined();
  });
});
