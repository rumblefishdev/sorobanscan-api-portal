/*
 * The token the hub's backend gives a product (Prices, x402) on each call, as the shared sign-in spec's decision 15
 * has it: `v1.<payload>.<mac>`, the claims' JSON in base64url and its HMAC-SHA256 under the
 * secret both sides read from AWS Secrets Manager (`product-secret.ts`). Prices checks it against
 * the same test vector (`bff/test/token.test.ts`), so a byte changed here is a token it refuses.
 */
import { createHmac, randomBytes } from "node:crypto";
import { isSnowflake } from "./discord.ts";

/** What a token lets the call do: one per call to Prices' contract. */
const ACTS = ["read", "reveal", "revoke", "issue"] as const;
export type Act = (typeof ACTS)[number];

/** The secret's length, as the spec's decision 12 gives it and Prices requires. */
export const SECRET_BYTES = 32;
/** How long a token holds after its `iat`. */
const TOKEN_TTL_SECONDS = 60;

const ISSUER = "https://sorobanscan.com/api/hub";
/** The products that take a token: each is its own `aud` and has a context of its own. */
export const TOKEN_PRODUCTS = ["prices", "x402"] as const;
export type TokenProduct = (typeof TOKEN_PRODUCTS)[number];
/** Put before the payload under the MAC, so a MAC made for anything else is never this one's. */
const contextOf = (product: TokenProduct) => `sorobanscan-hub/${product}-token/v1`;
const JTI_BYTES = 16;

/** Whom a token is for and what it lets the call do. */
export interface TokenRequest {
  /** The product the token is for: its name is the token's `aud`. */
  product: TokenProduct;
  /** The signed-in Discord account's id: the token's `sub` is `discord:<id>`. */
  discordId: string;
  /** Its username, for Prices to name the account by. Nothing is decided by it. */
  name: string;
  act: Act;
  /** The time, in milliseconds as `Date.now()` gives it: `iat` is its whole seconds. */
  now: number;
  /** The token's id, 16 bytes in base64url. A fresh random one unless given (the test vector). */
  jti?: string;
}

/**
 * A token for one call to Prices' hub contract, good for {@link TOKEN_TTL_SECONDS} from `now`.
 * Throws on a malformed request, naming the field and never the secret.
 */
export function mintToken(
  secret: Buffer,
  { product, discordId, name, act, now, jti = randomBytes(JTI_BYTES).toString("base64url") }: TokenRequest,
): string {
  if (secret.length !== SECRET_BYTES) {
    throw new Error(`A product token's secret must be ${SECRET_BYTES} bytes`);
  }
  if (!(TOKEN_PRODUCTS as readonly string[]).includes(product)) {
    throw new Error(`A product token's product must be one of ${TOKEN_PRODUCTS.join(", ")}`);
  }
  if (!isSnowflake(discordId)) {
    throw new Error("A product token's subject must be a Discord id, digits only");
  }
  if (typeof name !== "string") throw new Error("A product token's name must be a string");
  if (!(ACTS as readonly string[]).includes(act)) {
    throw new Error(`A product token's act must be one of ${ACTS.join(", ")}`);
  }
  if (!Number.isFinite(now)) {
    throw new Error("A product token's now must be a time in milliseconds");
  }
  if (!isJti(jti)) {
    throw new Error(`A product token's jti must be ${JTI_BYTES} bytes in base64url, unpadded`);
  }

  const iat = Math.floor(now / 1000);
  // In this order, as the test vector has them.
  const claims = {
    iss: ISSUER,
    aud: product,
    sub: `discord:${discordId}`,
    name,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    jti,
    act,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(contextOf(product)), Buffer.of(0), Buffer.from(payload)]))
    .digest("base64url");
  return `v1.${payload}.${mac}`;
}

/** Exactly what a fresh `jti` is: 16 bytes in base64url, unpadded, written as Node writes them. */
const isJti = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{22}$/.test(value) &&
  Buffer.from(value, "base64url").toString("base64url") === value;
