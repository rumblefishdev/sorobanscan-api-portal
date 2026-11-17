import { getRequestListener } from "@hono/node-server";
import { loadEnv, type Connect, type HttpServer, type Plugin, type ResolvedConfig } from "vite";
import { createHub } from "./app.ts";
import { readSettings } from "./settings.ts";

/**
 * The hub's backend on `pnpm dev` and `pnpm preview`: every request under `${base}hub/` goes to
 * {@link createHub}, so the page and its backend share one origin and the session cookie works
 * as it will in production. Nothing of it reaches the bundle: Vite runs it in the dev and preview
 * servers' Node process only.
 *
 * Its settings are read as the config reads its own, with `loadEnv(mode, envDir, "")`: from the
 * mode's `.env` files and `.env.local`, `process.env` winning over them. Without
 * `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `HUB_SESSION_SECRET` every hub route answers
 * 503 `sign_in_not_configured` and the rest of the app runs as before; a malformed one stops the
 * server from starting, naming it. `HUB_PUBLIC_ORIGIN` is `http://localhost:<port>` unless set,
 * with the port the server got, which is not 5173 when that one is taken.
 */
export function hubDevServer(): Plugin {
  return {
    name: "hub-backend",
    apply: "serve",
    configureServer(server) {
      mountHub(server.config, server.middlewares, server.httpServer);
    },
    configurePreviewServer(server) {
      mountHub(server.config, server.middlewares, server.httpServer);
    },
  };
}

/**
 * Puts the hub in front of Vite's own middlewares (a `configure…Server` hook's middlewares run
 * first), so neither the proxy nor the page's fallback to `index.html` sees its paths.
 */
function mountHub(
  config: ResolvedConfig,
  middlewares: Connect.Server,
  httpServer: HttpServer | null,
): void {
  // Vitest runs Vite in middleware mode, with no server of its own and no browser coming to it:
  // there is nothing to answer, so no setting is read.
  if (!httpServer) return;

  const env = loadEnv(config.mode, config.envDir, "");
  // Read now, so a malformed setting stops the server before anyone opens the page.
  const settings = readSettings(env, config.base);
  const prefix = `${config.base}hub/`;

  let listener: ReturnType<typeof getRequestListener> | undefined;
  /** Made at the first request, when the server listens and its port is known. */
  const hub = () => {
    if (listener) return listener;
    let configured = settings;
    const address = httpServer.address();
    if (configured && !env.HUB_PUBLIC_ORIGIN && typeof address === "object" && address !== null) {
      configured = { ...configured, publicOrigin: `http://localhost:${address.port}` };
    }
    // The dev server's process keeps Node's own `Request` and `Response`.
    listener = getRequestListener(createHub(configured).fetch, { overrideGlobalObjects: false });
    return listener;
  };

  middlewares.use((request, response, next) => {
    const [path = ""] = (request.url ?? "").split("?");
    if (!path.startsWith(prefix)) return next();
    hub()(request, response).catch(next);
  });
}
