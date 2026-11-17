import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLogger,
  createServer,
  preview,
  type Connect,
  type InlineConfig,
  type PreviewServer,
  type ViteDevServer,
} from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hubDevServer } from "../src/vite-plugin.ts";

/*
 * The dev and preview servers, started from the repo's own `vite.config.ts` as `pnpm dev` and
 * `pnpm preview` start them, on ports the system picks. Every setting the config and the hub
 * read is stubbed, so a local `.env.local` changes nothing here. The proxy's target is a server
 * of this test's that no test asks anything of: it records whatever reaches it, which must be
 * nothing, and nothing reaches the network.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));

/** Obviously not real: no request here reaches Discord. */
const SIGN_IN = {
  DISCORD_CLIENT_ID: "1234567890",
  DISCORD_CLIENT_SECRET: "not-a-real-client-secret",
  HUB_SESSION_SECRET: Buffer.alloc(32, 7).toString("base64"),
};
const NO_SIGN_IN = { DISCORD_CLIENT_ID: "", DISCORD_CLIENT_SECRET: "", HUB_SESSION_SECRET: "" };

/** Stands in for Prices' backend: answers every request with its path, and remembers it. */
let prices: Server;
const pricesSaw: string[] = [];
const scratch = mkdtempSync(join(tmpdir(), "hub-vite-plugin-"));
/** A built page for `vite preview` to serve, so the test doesn't need `pnpm build` first. */
const dist = join(scratch, "dist");

beforeAll(async () => {
  prices = createHttpServer((request, response) => {
    pricesSaw.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ proxied: request.url }));
  });
  await new Promise<void>((resolve) => prices.listen(0, "127.0.0.1", resolve));
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>the built page</title>");
});

afterAll(async () => {
  await new Promise((resolve) => prices.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
});

/** Stubs every setting the config and the hub read; `hub` sets the hub's own. */
function stubSettings(hub: Record<string, string>) {
  const { port } = prices.address() as AddressInfo;
  const settings: Record<string, string> = {
    VITE_BASE_PATH: "",
    DEV_API_PROXY_TARGET: `http://127.0.0.1:${port}`,
    DEV_API_KEY: "",
    DISCORD_GUILD_ID: "",
    HUB_PUBLIC_ORIGIN: "",
    ...hub,
  };
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
}

/** What the servers warned, through Vite's logger, which the plugin gets as `config.logger`. */
const warned: string[] = [];
const logger = createLogger("silent");
logger.warn = (message) => void warned.push(message);
/** The warnings about the hub's settings, the only ones the plugin gives. */
const hubWarnings = () => warned.filter((message) => /DISCORD_|HUB_/.test(message));

/** Started from the repo's config, away from the user's dev server and its dependency cache. */
const shared: InlineConfig = {
  configFile: join(root, "vite.config.ts"),
  root,
  customLogger: logger,
  cacheDir: join(scratch, "vite-cache"),
};

let running: (ViteDevServer | PreviewServer)[] = [];

async function startDev(): Promise<ViteDevServer> {
  const server = await createServer({
    ...shared,
    server: { port: 0, strictPort: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
  });
  running.push(server);
  return server.listen();
}

async function startPreview(): Promise<PreviewServer> {
  const server = await preview({
    ...shared,
    build: { outDir: dist },
    preview: { port: 0, strictPort: true },
  });
  running.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(running.map((server) => server.close()));
  running = [];
  pricesSaw.length = 0;
  warned.length = 0;
  vi.unstubAllEnvs();
});

/** The port the server listens on, which the system picked. */
const portOf = (server: ViteDevServer | PreviewServer) =>
  (server.httpServer?.address() as AddressInfo).port;

/** Asks `server` for `path` as a browser on the same machine would. */
function ask(server: ViteDevServer | PreviewServer, path: string, accept = "*/*") {
  const at = server.resolvedUrls?.local[0];
  if (!at) throw new Error("the server has no local address");
  return fetch(new URL(path, at), { redirect: "manual", headers: { accept } });
}

const redirectUriOf = (response: Response) =>
  new URL(response.headers.get("location") ?? "").searchParams.get("redirect_uri");

/** The Prices backend's rule, as `vite.config.ts` gives it to both servers' proxies. */
const PRICES_RULE = String.raw`^/api/(auth|key|usage|config|api-docs-json)(/|\?|$)`;

/** Each server with the proxy it resolved: dev's is `server.proxy`, preview's `preview.proxy`. */
describe.each([
  ["the dev server", startDev, (server: ViteDevServer | PreviewServer) => server.config.server],
  [
    "the preview server",
    startPreview,
    (server: ViteDevServer | PreviewServer) => server.config.preview,
  ],
] as const)("%s", (_, start, options) => {
  it("answers /api/hub/* with the hub's backend, signed in from its own port", async () => {
    stubSettings(SIGN_IN);
    const server = await start();

    const me = await ask(server, "/api/hub/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ authenticated: false });

    // The callback Discord is told is on this server, at the port it got.
    const login = await ask(server, "/api/hub/auth/login");
    expect(login.status).toBe(303);
    expect(redirectUriOf(login)).toBe(`http://localhost:${portOf(server)}/api/hub/auth/callback`);
    expect(login.headers.get("location")).not.toContain(SIGN_IN.DISCORD_CLIENT_SECRET);

    // Not the Prices backend's, and not the page's.
    expect(pricesSaw).toEqual([]);
    expect(hubWarnings()).toEqual([]);
  });

  // Nothing is asked of the Prices backend: its rule is read from the resolved proxy, and what
  // the plugin passes on is shown without a server, below.
  it("leaves the page and the Prices backend's paths as they were", async () => {
    stubSettings(SIGN_IN);
    const server = await start();

    for (const path of ["/api/", "/api/hub", "/api/hubx/me"]) {
      const page = await ask(server, path, "text/html");
      expect(page.status, path).toBe(200);
      expect(page.headers.get("content-type"), path).toMatch(/^text\/html/);
      expect(await page.text(), path).toMatch(/<html|<title>/i);
    }

    const proxy = options(server).proxy ?? {};
    expect(Object.keys(proxy)).toContain(PRICES_RULE);
    expect(proxy[PRICES_RULE]).toMatchObject({ target: process.env.DEV_API_PROXY_TARGET });
    const rule = new RegExp(PRICES_RULE);
    expect(rule.test("/api/config")).toBe(true);
    expect(rule.test("/api/hub/me")).toBe(false);
    expect(pricesSaw).toEqual([]);
  });

  it("answers 503 without the three settings, and the page still works", async () => {
    stubSettings(NO_SIGN_IN);
    const server = await start();

    for (const path of ["/api/hub/me", "/api/hub/auth/login"]) {
      const response = await ask(server, path);
      expect(response.status, path).toBe(503);
      expect(await response.json(), path).toEqual({ error: "sign_in_not_configured" });
    }
    expect((await ask(server, "/api/", "text/html")).status).toBe(200);
    // None of them set is a dev setup without sign-in, not a mistake: nothing to warn about.
    expect(hubWarnings()).toEqual([]);
  });

  // One or two of the three is most likely a typo or a line left out: it still answers 503, and
  // says which are missing, never what the others hold.
  it("warns, naming the missing ones, when only some of the three are set", async () => {
    const needed = "DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and HUB_SESSION_SECRET";
    for (const [set, missing] of [
      [
        { ...NO_SIGN_IN, DISCORD_CLIENT_ID: SIGN_IN.DISCORD_CLIENT_ID },
        "DISCORD_CLIENT_SECRET and HUB_SESSION_SECRET are",
      ],
      [{ ...SIGN_IN, HUB_SESSION_SECRET: "" }, "HUB_SESSION_SECRET is"],
    ] as const) {
      warned.length = 0;
      stubSettings(set);
      const server = await start();
      expect(hubWarnings()).toEqual([
        `The hub's sign-in needs ${needed}; ${missing} not set, so /api/hub/* answers 503.`,
      ]);
      for (const value of Object.values(SIGN_IN)) expect(warned.join("\n")).not.toContain(value);
      const me = await ask(server, "/api/hub/me");
      expect(await me.json()).toEqual({ error: "sign_in_not_configured" });
    }
  });

  it("takes HUB_PUBLIC_ORIGIN as it is given", async () => {
    stubSettings({ ...SIGN_IN, HUB_PUBLIC_ORIGIN: "http://hub.localhost:8080" });
    const server = await start();
    const login = await ask(server, "/api/hub/auth/login");
    expect(redirectUriOf(login)).toBe("http://hub.localhost:8080/api/hub/auth/callback");
  });

  it("refuses to start with a malformed session secret, without repeating it", async () => {
    const secret = "too-short";
    stubSettings({ ...SIGN_IN, HUB_SESSION_SECRET: secret });
    const started = start();
    await expect(started).rejects.toThrow(/HUB_SESSION_SECRET/);
    await expect(started).rejects.not.toThrow(secret);
  });

  // Not only once the last required one is set: a typo is reported the first time it is there.
  it("refuses to start with a malformed setting while the others are missing", async () => {
    stubSettings({ ...NO_SIGN_IN, DISCORD_GUILD_ID: "Stellar" });
    await expect(start()).rejects.toThrow(/DISCORD_GUILD_ID/);
  });
});

// As Vitest runs Vite, the server of every `pnpm test`: with no server of its own nobody can ask
// it anything, so the hub reads no setting, and a broken `.env.local` doesn't stop the tests.
it("reads nothing in middleware mode", async () => {
  stubSettings({ ...SIGN_IN, HUB_SESSION_SECRET: "too-short" });
  const server = await createServer({
    ...shared,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
  });
  running.push(server);
  expect(server.httpServer).toBeNull();
});

/**
 * The plugin's middleware as `configureServer` hands it to Vite, on a server that listens
 * nowhere: no request leaves this process.
 */
function mountedMiddleware(base = "/api/"): Connect.NextHandleFunction {
  const used: Connect.NextHandleFunction[] = [];
  const server = {
    config: { mode: "development", envDir: scratch, base, logger },
    middlewares: { use: (handler: Connect.NextHandleFunction) => used.push(handler) },
    httpServer: { address: () => null },
  };
  const hook = hubDevServer().configureServer;
  const configure = typeof hook === "function" ? hook : hook?.handler;
  void configure?.call({} as never, server as unknown as ViteDevServer);
  const [middleware] = used;
  if (!middleware || used.length !== 1) throw new Error("the plugin mounted no middleware");
  return middleware;
}

describe("the plugin's middleware", () => {
  // `next()` at once and with no error: had the hub taken the request, it would have answered on
  // the (empty) response, or failed later, not called `next` here.
  it("passes on every path outside /api/hub/, /api/hub itself and /api/hubx/ too", () => {
    stubSettings(SIGN_IN);
    const middleware = mountedMiddleware();
    for (const url of [
      "/api/",
      "/api/config",
      "/api/config?fresh=1",
      "/api/auth/login",
      "/api/hub",
      "/api/hub?state=x",
      "/api/hubx/me",
      "/api/hub-x/me",
      "/api/prices-api/hub/me",
      "/api/next/hub/me",
      "/hub/me",
    ]) {
      const next = vi.fn();
      middleware({ url, method: "GET", headers: {} } as Connect.IncomingMessage, {} as never, next);
      expect(next, url).toHaveBeenCalledTimes(1);
      expect(next, url).toHaveBeenCalledWith();
    }
  });
});

describe("the hub's backend under another prefix", () => {
  it("answers under that prefix", async () => {
    stubSettings({ ...SIGN_IN, VITE_BASE_PATH: "/api/next/" });
    const server = await startDev();
    const me = await ask(server, "/api/next/hub/me");
    expect(await me.json()).toEqual({ authenticated: false });
    const login = await ask(server, "/api/next/hub/auth/login");
    expect(redirectUriOf(login)).toBe(
      `http://localhost:${portOf(server)}/api/next/hub/auth/callback`,
    );
  });
});
