/*
 * Prices as a product of the hub: `client.ts`'s client for `prices`, under the names the hub's
 * routes and tests already use.
 */
import {
  productClient,
  PRODUCT_TIMEOUT_MS,
  type Caller,
  type IssueBody,
  type IssueOutcome,
  type ProductAnswer,
  type ProductClient,
  type ProductClientOptions,
} from "./client.ts";

export type { Caller, IssueBody, IssueOutcome };
/** How long a call to Prices may take, the secret's read and its one retry included. */
export const PRICES_TIMEOUT_MS = PRODUCT_TIMEOUT_MS;
export type PricesAnswer<Body = Record<string, unknown>> = ProductAnswer<Body>;
export type PricesClient = ProductClient;
export type PricesClientOptions = Omit<ProductClientOptions, "product" | "label">;

/** {@link ProductClient} for Prices. */
export const pricesClient = (options: PricesClientOptions): PricesClient =>
  productClient({ ...options, product: "prices", label: "Prices" });
