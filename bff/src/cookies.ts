/*
 * From stellar-x402's `apps/portal/src/cookies.ts` at 4157f642 (Apache-2.0, same organisation).
 * Changed: the hub's cookie names, and paths under the app's prefix instead of fixed ones.
 */

/**
 * The hub's two cookies. Both hold a signed base64url value and nothing else, so there is no
 * quoting or escaping here, and no cookie library to reason about on a public route.
 *
 * Each is `HttpOnly`, so no script reads it; `Secure`, except on `http://localhost`; host-only,
 * with no `Domain`, so no other host under `sorobanscan.com` gets it; and `SameSite=Lax`, not
 * `Strict`: Discord sending the browser back to the callback is a navigation from another site,
 * and `Strict` would withhold the cookie the callback needs.
 */

/** The session: who is signed in. Sent with every request to the hub's backend. */
export const SESSION_COOKIE = "hub_session";
export const sessionPath = (base: string): string => `${base}hub`;

/** The browser's half of a sign-in under way. Only the callback reads it. */
export const PENDING_COOKIE = "hub_oauth";
export const pendingPath = (base: string): string => `${base}hub/auth`;

/** Whether the cookies are `Secure`: everywhere but on `http://localhost`, where they can't be. */
export function secureCookies(publicOrigin: string): boolean {
  const url = new URL(publicOrigin);
  return !(url.protocol === "http:" && url.hostname === "localhost");
}

/** The first cookie named `name` in a `Cookie` header. Its value is used only once verified. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const pair of header?.split(";") ?? []) {
    const at = pair.indexOf("=");
    if (at !== -1 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return undefined;
}

const attributes = (path: string, maxAgeSeconds: number, secure: boolean) =>
  `Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`;

/** A `Set-Cookie` value that stores `value` for `maxAgeSeconds`. */
export const setCookie = (
  name: string,
  value: string,
  path: string,
  maxAgeSeconds: number,
  secure: boolean,
): string => `${name}=${value}; ${attributes(path, maxAgeSeconds, secure)}`;

/** A `Set-Cookie` value that deletes the cookie: the same name, path and attributes, no age. */
export const clearCookie = (name: string, path: string, secure: boolean): string =>
  `${name}=; ${attributes(path, 0, secure)}`;
