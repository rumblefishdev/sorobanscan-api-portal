/**
 * The prefix the hub is served from, `https://sorobanscan.com/api/`. A build for another address
 * (a preview, say) sets `VITE_BASE_PATH`; Vite's `base` and the router's `basename` both follow it.
 */
export const DEFAULT_BASE_PATH = "/api/";

/**
 * The prefix for the build setting `VITE_BASE_PATH`: `/api/` when it is absent or empty. A value
 * must start and end with a slash, the form Vite documents for `base`. Anything else stops the
 * build, naming the setting, rather than being guessed at.
 */
export function basePath(setting: string | undefined): string {
  if (!setting) return DEFAULT_BASE_PATH;
  if (!setting.startsWith("/") || !setting.endsWith("/")) {
    throw new Error(
      `VITE_BASE_PATH must start and end with "/", as "/api/next/" does; got "${setting}"`,
    );
  }
  return setting;
}

/** The router's `basename`: the prefix without its last slash, which the router won't take. */
export function routerBasename(base: string): string {
  return base.replace(/\/$/, "");
}
