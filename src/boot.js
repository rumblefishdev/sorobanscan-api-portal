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
 * Whether `pathname` is one of the account pages, every product's: the sign-in, `${base}login`,
 * and the dashboard, the quick start and the API reference, each with anything under it (a
 * product's tab, and under `docs` the product's OpenAPI document, which is a file and never
 * reaches this page).
 */
export function isAccountPath(pathname, base) {
  if (pathname === `${base}login`) return true;
  return ["dashboard", "quick-start", "docs"].some((page) => {
    const address = `${base}${page}`;
    return pathname === address || pathname.startsWith(`${address}/`);
  });
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
