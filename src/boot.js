// The page's one entry: it picks the tree for the address and imports that tree's entry, which
// brings its own styles, fonts and router, so neither tree's reach the other. Plain JavaScript,
// with its type in `boot.d.ts`, so the hub's type check doesn't follow it into `src/prices`,
// which `tsconfig.prices.json` checks with Prices' own options.
import { bridgeOAuthPopup } from "./prices/landing/oauthPopup.ts";

/**
 * Whether `pathname` is a Prices portal address: `${base}prices-api` or anything under it, and
 * not a hub address that only starts with the same letters, such as `${base}prices-apiX`.
 */
export function isPricesPath(pathname, base) {
  const prices = `${base}prices-api`;
  return pathname === prices || pathname.startsWith(`${prices}/`);
}

// Before anything mounts: when this document is the Prices portal's Discord sign-in popup, its
// only job is to hand the outcome to the window that opened it and close (`oauthPopup.ts`).
// Booting a tree in it would leave the visitor with a second copy of the portal in the popup.
if (!bridgeOAuthPopup()) {
  if (isPricesPath(location.pathname, import.meta.env.BASE_URL)) import("./prices/main.tsx");
  else import("./hub/main.tsx");
}
