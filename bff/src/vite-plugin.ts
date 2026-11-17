import { getRequestListener } from "@hono/node-server";
import { loadEnv, type Connect, type HttpServer, type Plugin, type ResolvedConfig } from "vite";
import { createHub } from "./app.ts";
import { missingSettings, readSettings, REQUIRED_SETTINGS } from "./settings.ts";

/**
 * What the dev and preview servers give in place of a setting left unset. `readSettings` has no
 * default of its own, so only these servers fall back to a localhost origin. The port is replaced
 * by the one the server got at the first request.
 */
const DEV_DEFAULTS = { HUB_PUBLIC_ORIGIN: "http://localhost:5173" };

/** The required settings a developer has to give: those the servers have no default for. */
const NEEDED = REQUIRED_SETTINGS.filter((name) => !(name in DEV_DEFAULTS));

/**
 * The hub's backend on `pnpm dev` and `pnpm preview`: every request under `${base}hub/` goes to
 * {@link createHub}, so the page and its backend share one origin and the session cookie works
 * as it will in production. Nothing of it reaches the bundle: Vite runs it in the dev and preview
 * servers' Node process only.
 *
 * Its settings are read as the config reads its own, with `loadEnv(mode, envDir, "")`: from the
 * mode's `.env` files and `.env.local`, `process.env` winning over them. Without
 * `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `HUB_SESSION_SECRET` every hub route answers
 * 503 `sign_in_not_configured` and the rest of the app runs as before; with only some of them it
 * answers the same and warns, naming the missing ones. A malformed `HUB_SESSION_SECRET`,
 * `DISCORD_GUILD_ID` or `HUB_PUBLIC_ORIGIN` stops the server from starting, naming it, whether or
 * not the others are set. `HUB_PUBLIC_ORIGIN` is `http://localhost:<port>` unless set, with the
 * port the server got, which is not 5173 when that one is taken.
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
 * Mounts the hub where Vite puts a `configure…Server` hook's middlewares: after Vite's own check
 * of the request (dev only), CORS and `Host` check (`allowedHosts`), which Vite registers before
 * any plugin's, and before the proxy, the prefix (`base`) middleware and the fallback to
 * `index.html`, so none of those sees the hub's paths.
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
  const given = {
    ...env,
    HUB_PUBLIC_ORIGIN: env.HUB_PUBLIC_ORIGIN || DEV_DEFAULTS.HUB_PUBLIC_ORIGIN,
  };
  // Read now, so a malformed setting stops the server before anyone opens the page, even with
  // the others unset.
  const settings = readSettings(given, config.base);
  const prefix = `${config.base}hub/`;

  // None of the three is a dev setup without sign-in; one or two is a mistake worth a line. By
  // name only: a value is never printed.
  const missing = missingSettings(given);
  if (missing.length > 0 && missing.length < NEEDED.length) {
    const needed = `${NEEDED.slice(0, -1).join(", ")} and ${NEEDED.at(-1)}`;
    const lacking = `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"}`;
    config.logger.warn(
      `The hub's sign-in needs ${needed}; ${lacking} not set, so ${prefix}* answers 503.`,
    );
  }

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
