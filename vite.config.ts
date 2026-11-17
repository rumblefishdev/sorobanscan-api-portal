import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin, type ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";
import { basePath, DEFAULT_BASE_PATH } from "./src/base-path.ts";

/**
 * Only the hub at `/api/` should be found by search engines: a build for any other prefix gets
 * `noindex`. It reads the resolved `base`, so a `base` handed to Vite directly counts too.
 */
const noindexOutsideApi = (): Plugin => {
  let base: string;
  return {
    name: "noindex-outside-api",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: () =>
      base === DEFAULT_BASE_PATH
        ? []
        : [{ tag: "meta", attrs: { name: "robots", content: "noindex" }, injectTo: "head" }],
  };
};

/*
 * The dev server's proxy to the Prices portal's backend, as stellar-prices-api's
 * `web/portal/vite.config.mts` has it at 7d9e9e70, mirroring `soroban-block-explorer`'s pattern.
 *
 * The browser only ever talks to localhost, so dev is same-origin. Production is not: the page is
 * on the explorer's host and calls the API on its own hostname, cross-origin and same-site
 * (`VITE_PORTAL_API_ORIGIN`), so a CORS or cookie problem on the backend's side is one this proxy
 * cannot show. What it does show is everything else, with one origin and no build variable to set.
 *
 * `DEV_API_PROXY_TARGET` should be the **API's own hostname**
 * (`https://prices-api.sorobanscan.com`), not the execute-api URL: the custom domain serves these
 * paths at exactly the shape this proxy forwards, whereas execute-api serves them under `/{stage}`
 * and would need a rewrite here that production does not perform.
 */

/**
 * The backend's top-level segments under `/api/`. The bundle shares the prefix (here it is served
 * from `/api/` itself, the Prices pages from `/api/prices-api/`), and a plain `/api` proxy rule
 * would swallow Vite's own `/api/@vite/…` and `/api/src/…` requests and every page, so the backend
 * is enumerated as one regex key. Adding a backend route at a NEW top-level segment means adding
 * it here — a fetch to a missing one is a Vite 404, loud and local. A segment named `prices-api`
 * would take the Prices pages, one named `hub` the shared sign-in's backend to come.
 */
const PORTAL_BACKEND_SEGMENTS = ["auth", "key", "usage", "config", "api-docs-json"];
const PORTAL_BACKEND_PROXY = `^/api/(${PORTAL_BACKEND_SEGMENTS.join("|")})(/|\\?|$)`;

const PROXIED_PATHS = [
  // The portal's own backend (Prices task 0183's gate, keyless by design). Covers task 0186's
  // `/auth/*` by prefix, which matters for more than reachability: the sign-in round-trip only
  // works locally if the browser sees ONE origin, so that the `SameSite=Lax` session cookie set
  // by the callback is sent back on the next request. A separate backend port would break that in
  // a way no test in this repo can see.
  //
  // ⚠️ For the sign-in round-trip, `DEV_API_PROXY_TARGET` must point at a LOCAL
  // `cargo run --bin serve` (with `PORTAL_ENABLED=true` and a `PORTAL_OAUTH_SECRET_FILE`), not at
  // production — the production callback is registered against the production host and lands
  // there, never back on localhost. See stellar-prices-api's `packages/prices-api/README.md`,
  // "Running portal sign-in locally".
  //
  // A regex key (Vite treats keys starting with `^` as RegExp) — see `PORTAL_BACKEND_SEGMENTS`.
  PORTAL_BACKEND_PROXY,
  // The data routes, for when a portal page needs to show a real API response.
  "/v1",
  "/health",
  "/api-docs-json",
] as const;

/** Only `/v1` requires a key — see the note in `devProxy`. */
const KEYED_PATHS: readonly string[] = ["/v1"];

/**
 * The target when `DEV_API_PROXY_TARGET` is unset or empty: Prices' public production API, so
 * `pnpm dev` alone shows the Prices portal as production does (akot, 2026-11-17). "Get API Key"
 * opens Discord, but the round trip ends on production and does not complete here (see
 * `PROXIED_PATHS`). stellar-prices-api has no default and runs against nothing. For a local
 * backend, set the variable instead, in `.env.local`, which `pnpm dev` and `pnpm preview` both
 * read, or in the environment: e.g. `DEV_API_PROXY_TARGET=http://localhost:8080` for
 * `cargo run --bin serve`, whose port is 8080. Not in `.env.development`, which `pnpm preview`
 * (mode `production`) never reads, so it would go to production with no sign of the switch.
 */
const DEFAULT_DEV_API_PROXY_TARGET = "https://prices-api.sorobanscan.com";

/**
 * The proxy for `server` and `preview`: each of `PROXIED_PATHS` to `target`, and `apiKey` as
 * `x-api-key` on `/v1` alone. No target, no proxy; the config gives it
 * `DEFAULT_DEV_API_PROXY_TARGET` when the setting is unset.
 */
export function devProxy(
  target: string | undefined,
  apiKey: string | undefined,
): Record<string, ProxyOptions> | undefined {
  if (!target) return undefined;
  return Object.fromEntries(
    PROXIED_PATHS.map((path) => [
      path,
      {
        target,
        // Rewrite `Host` so CloudFront routes to the right distribution.
        changeOrigin: true,
        secure: true,
        // Injected SERVER-SIDE, per path, and only where a key is actually required. The
        // portal's own routes are keyless on purpose (a visitor signing in to get a key does not
        // have one yet), so sending a key to `/api/*` in dev would test a configuration
        // production never runs.
        ...(apiKey && KEYED_PATHS.includes(path) ? { headers: { "x-api-key": apiKey } } : {}),
      },
    ]),
  );
}

export default defineConfig(({ mode }) => {
  // Every setting is read as Vite reads its own: from the `.env` files of the mode, and from
  // `process.env`, which wins over them. The `""` prefix loads ALL of them, not just `VITE_` ones.
  // That is deliberate and it is the security property of this file: `DEV_API_PROXY_TARGET` and
  // `DEV_API_KEY` are read HERE, in the Node config, and only `VITE_`-prefixed variables reach
  // `import.meta.env` in the bundle. A dev key put in `VITE_API_KEY` would be compiled into the
  // JavaScript and served to every visitor. No API key and no secret may reach the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  const base = basePath(env.VITE_BASE_PATH);
  const proxy = devProxy(env.DEV_API_PROXY_TARGET || DEFAULT_DEV_API_PROXY_TARGET, env.DEV_API_KEY);
  return {
    base,
    server: { proxy },
    preview: {
      // The SAME proxy as `server`: `vite preview` is the only local way to run the actual built
      // bundle — base-prefixed asset URLs, minified chunks, no dev transforms — and so the one
      // local check that resembles what CloudFront serves. Without a proxy here it could only
      // render the "could not reach the portal backend" branch.
      proxy,
    },
    plugins: [react(), noindexOutsideApi()],
    test: {
      include: ["test/**/*.test.{ts,tsx}", "src/prices/**/*.spec.{ts,tsx}"],
      environment: "jsdom",
      setupFiles: ["test/setup.ts"],
      // Vitest gives `import.meta.env.BASE_URL` as `/` whatever `base` is. The tests see the
      // build's, which the boot module and the Prices paths are derived from.
      env: { BASE_URL: base },
    },
  };
});
