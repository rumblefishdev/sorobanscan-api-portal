/**
 * Every address the page links to, in one place. The explorer and the x402 Facilitator's page are
 * other apps on the same site, so their addresses are relative to it and the page works on any
 * host; they are where they are whatever prefix this bundle is built for.
 */
export const EXPLORER_URL = "/";
export const X402_URL = "/api/x402-facilitator/";
export const GITHUB_URL = "https://github.com/rumblefishdev/stellar-x402";

/**
 * The prefix this bundle is built for, `/api/` unless `VITE_BASE_PATH` says another. The pages
 * below are this bundle's own, in its other trees (`src/boot.js`), so they are under it: a build
 * for `/api/next/` is the whole app there, and a link that stayed under `/api/` would take the
 * visitor out of it, to whatever production serves at that address. As the Prices pages' and the
 * account pages' own links are (`src/prices/landing/links.ts`).
 */
const BASE = import.meta.env.BASE_URL;

/** The Prices portal's landing page. */
export const PRICES_API_URL = `${BASE}prices-api/`;

/**
 * The sign-in, one for every product: a page of another tree, so a plain link. It sends a visitor
 * who is signed in already on to the dashboard.
 */
export const LOGIN_URL = `${BASE}login`;

/**
 * The quick start and the API reference, one page of each for every product and open to
 * everybody: pages of that same other tree. The first product's tab, never the bare
 * `/api/quick-start` or `/api/docs`: the explorer answered those with a `301` into the Prices
 * portal, which now sends the browser back to the tab, and a browser that kept the redirect
 * would take that detour on every visit.
 */
export const QUICK_START_URL = `${BASE}quick-start/prices`;
export const DOCS_URL = `${BASE}docs/prices`;

/** The ids of the page's parts that its own links point at, as `#${id}`. */
export const ANCHORS = {
  top: "top", products: "products", choose: "choose",
  stack: "stack", faq: "faq", sorobanScanApi: "soroban-scan-api",
} as const;
