/**
 * The prefix the hub is served from, `https://sorobanscan.com/api/`. A build for another address
 * (a preview, say) sets `VITE_BASE_PATH`; Vite's `base` and the router's `basename` both follow it.
 */
export const DEFAULT_BASE_PATH = "/api/";

/**
 * The prefix for the build setting `VITE_BASE_PATH`: `/api/` when it is absent or empty. A value
 * must start and end with a slash, the form Vite documents for `base`, and be a path on the page's
 * own host: `//api/next/`, or `/\api/next/` which a browser reads the same, names the host `api`,
 * and the page would ask it for its files. Anything else stops the build, naming the setting,
 * rather than being guessed at.
 */
export function basePath(setting: string | undefined): string {
  if (!setting) return DEFAULT_BASE_PATH;
  if (!setting.startsWith("/") || !setting.endsWith("/")) {
    throw new Error(
      `VITE_BASE_PATH must start and end with "/", as "/api/next/" does; got "${setting}"`,
    );
  }
  if (/^\/[/\\]/.test(setting)) {
    throw new Error(
      `VITE_BASE_PATH must be a path on the page's own host, starting with one "/"; got "${setting}", which names another host`,
    );
  }
  return setting;
}

/** The router's `basename`: the prefix without its last slash, which the router won't take. */
export function routerBasename(base: string): string {
  return base.replace(/\/$/, "");
}
