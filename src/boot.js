// The page's one entry: it picks the tree for the address and imports that tree's entry, which
// brings its own styles, fonts and router, so no tree's reach another. Plain JavaScript,
// with its type in `boot.d.ts`, so the hub's type check doesn't follow it into `src/prices` or
// `src/account`, which `tsconfig.prices.json` checks with Prices' own options.
import { bridgeOAuthPopup } from "./prices/landing/oauthPopup.ts";

/**
 * Whether `pathname` is a Prices portal address: `${base}prices-api` or anything under it, and
 * not a hub address that only starts with the same letters, such as `${base}prices-apiX`.
 */
export function isPricesPath(pathname, base) {
  const prices = `${base}prices-api`;
  return pathname === prices || pathname.startsWith(`${prices}/`);
}

/**
 * Whether `pathname` is one of the account pages, every product's sign-in and dashboard:
 * `${base}login`, `${base}dashboard` or anything under the dashboard (a product's tab).
 */
export function isAccountPath(pathname, base) {
  const dashboard = `${base}dashboard`;
  return (
    pathname === `${base}login` || pathname === dashboard || pathname.startsWith(`${dashboard}/`)
  );
}

// Before anything mounts: when this document is the Prices portal's Discord sign-in popup, its
// only job is to hand the outcome to the window that opened it and close (`oauthPopup.ts`).
// Booting a tree in it would leave the visitor with a second copy of the portal in the popup.
// Each tree is a literal `import()`, so the build splits it into chunks of its own.
if (!bridgeOAuthPopup()) {
  const base = import.meta.env.BASE_URL;
  if (isPricesPath(location.pathname, base)) import("./prices/main.tsx");
  else if (isAccountPath(location.pathname, base)) import("./account/main.tsx");
  else import("./hub/main.tsx");
}
