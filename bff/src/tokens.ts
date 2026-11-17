/*
 * From stellar-x402's `apps/portal/src/tokens.ts` at 4157f642 (Apache-2.0, same organisation).
 * Changed: the key derivation's label names the hub, so a value signed by x402's portal is never
 * one of the hub's, even under the same secret.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * What a signed value is for. Each is signed under a key of its own, so a value minted as one
 * thing is never accepted as another: a sign-in's `state`, which travels through Discord and the
 * address bar, can't be presented as a session.
 */
export type TokenContext = "session" | "state" | "pending";

export interface Tokens {
  /** `claims` and an expiry `ttlSeconds` from now, signed for `context`. Cookie- and URL-safe. */
  sign(context: TokenContext, claims: Record<string, unknown>, ttlSeconds: number): string;
  /**
   * The claims of a token signed for `context` that hasn't expired, or `undefined` for anything
   * else: a missing, edited, forged or expired one, or one signed for another context.
   */
  verify<T extends Record<string, unknown>>(
    context: TokenContext,
    token: string | undefined,
  ): T | undefined;
}

/**
 * Signed, self-contained values: the claims as JSON in base64url, a dot, and their HMAC-SHA256.
 * Nothing is stored on the server, so there is no session table to grow or to read.
 */
export function tokens(secret: Buffer, now: () => number = Date.now): Tokens {
  const keyFor = (context: TokenContext) =>
    createHmac("sha256", secret).update(`sorobanscan-hub/${context}/v1`).digest();
  const mac = (context: TokenContext, body: string) =>
    createHmac("sha256", keyFor(context)).update(body).digest();
  const seconds = () => Math.floor(now() / 1000);

  return {
    sign(context, claims, ttlSeconds) {
      const body = Buffer.from(
        JSON.stringify({ ...claims, exp: seconds() + ttlSeconds }),
        "utf8",
      ).toString("base64url");
      return `${body}.${mac(context, body).toString("base64url")}`;
    },
    verify<T extends Record<string, unknown>>(context: TokenContext, token: string | undefined) {
      if (token === undefined) return undefined;
      const parts = token.split(".");
      const [body, signature] = parts;
      if (parts.length !== 2 || !body || !signature) return undefined;
      const given = Buffer.from(signature, "base64url");
      const expected = mac(context, body);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
      let claims: unknown;
      try {
        claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      } catch {
        return undefined;
      }
      if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return undefined;
      const { exp } = claims as { exp?: unknown };
      if (typeof exp !== "number" || exp <= seconds()) return undefined;
      return claims as T;
    },
  };
}
