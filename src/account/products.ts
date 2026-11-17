/** The APIs with a tab on the dashboard, in the tabs' order. */
export const PRODUCTS = ["prices", "x402"] as const;
export type Product = (typeof PRODUCTS)[number];

/** Each product's tab label. */
export const PRODUCT_NAME: Record<Product, string> = {
  prices: "Prices API",
  x402: "x402",
};

/** What a build gets when it names no product: Prices opens first, x402 later (spec decision 5). */
const DEFAULT_PRODUCTS: readonly Product[] = ["prices"];

/**
 * The products a build turns on, from the build setting `VITE_PRODUCTS`: a comma list such as
 * `prices,x402`. A setting that names nothing (absent, empty, only commas) gets Prices alone.
 * Names it doesn't know are ignored, so a setting that names only those turns every tab off.
 * In the tabs' order, whatever the setting's, and each once.
 */
export function enabledProducts(setting: string | undefined): Product[] {
  const named = (setting ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (named.length === 0) return [...DEFAULT_PRODUCTS];
  return PRODUCTS.filter((product) => named.includes(product));
}
