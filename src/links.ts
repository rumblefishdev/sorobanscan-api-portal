/**
 * Every address the page links to, in one place. The products and the explorer are other apps on
 * the same site, so their addresses are relative to it and the page works on any host.
 */
export const EXPLORER_URL = "/";
export const PRICES_API_URL = "/api/prices-api/";
export const X402_URL = "/api/x402-facilitator/";
export const GITHUB_URL = "https://github.com/rumblefishdev/stellar-x402";

/** The sign-in and the dashboard, one for every product: pages of another tree, so plain links. */
export const LOGIN_URL = "/api/login";
export const DASHBOARD_URL = "/api/dashboard";

/** The ids of the page's parts that its own links point at, as `#${id}`. */
export const ANCHORS = {
  top: "top", products: "products", choose: "choose",
  stack: "stack", faq: "faq", sorobanScanApi: "soroban-scan-api",
} as const;
