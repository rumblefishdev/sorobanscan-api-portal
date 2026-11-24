import { HUB } from "../session";
import {
  call,
  HubError,
  isInstant,
  isObject,
  keyIsGone,
} from "../prices/api";

/**
 * The x402 tab's calls, all to the hub's backend (`bff/src/products/client.ts`), which signs a token
 * for each and asks x402's hub contract: the page never calls x402. The same transport as the
 * Prices tab's (`../prices/api.ts`: the timeout, the non-JSON answer, the `HubError`), under
 * `hub/x402/`.
 */

const X402 = `${HUB}x402/`;
const ACCOUNT_URL = `${X402}account`;
const REVEAL_URL = `${X402}key/reveal`;
const REVOKE_URL = `${X402}key/revoke`;

export { HubError, keyIsGone };

/** The account's key, as x402's `account` states it. Its instants are RFC 3339. */
export type X402Key =
  | { state: "none"; can_issue: boolean }
  | { state: "active"; key_id: string; created_at?: string | null; can_issue: boolean }
  | {
      state: "revoked";
      revoked_at?: string | null;
      next_eligible_at?: string | null;
      can_issue: boolean;
    };

/**
 * The account's payments on Mainnet this month against its plan's quota, as x402's
 * `details.usage` states them, in Prices' shape. Counts are whole and `remaining` is never below
 * 0, while `used` can pass `limit`, which is at least 1. Instants are RFC 3339, UTC, to the second.
 */
export interface X402Usage {
  used: number;
  remaining: number;
  limit: number;
  period_start: string;
  period_end: string;
  resets_at: string;
  as_of: string;
  plan: { name: string; quota_limit: number; quota_period: "month" };
}

/** x402's `account`: the key, whether `key/reveal` can show it, and the month's payments. */
export interface X402Account {
  key: X402Key;
  showable: boolean;
  /**
   * `null` when x402 couldn't read them, and `undefined` when it sent none: an account without a
   * key, or an x402 older than its account quota.
   */
  usage: X402Usage | null | undefined;
}

/** x402's key, or `undefined` when the answer isn't one of its three states. */
function keyOf(value: unknown): X402Key | undefined {
  if (!isObject(value) || typeof value.can_issue !== "boolean") return undefined;
  const { can_issue } = value;
  switch (value.state) {
    case "none":
      return { state: "none", can_issue };
    case "active":
      return typeof value.key_id === "string" && isInstant(value.created_at)
        ? { state: "active", key_id: value.key_id, created_at: value.created_at, can_issue }
        : undefined;
    case "revoked":
      return isInstant(value.revoked_at) && isInstant(value.next_eligible_at)
        ? {
            state: "revoked",
            revoked_at: value.revoked_at,
            next_eligible_at: value.next_eligible_at,
            can_issue,
          }
        : undefined;
    default:
      return undefined;
  }
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

/** An instant as x402 writes one: RFC 3339 in UTC, to the second; a fraction is let through. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isTime = (value: unknown): value is string => {
  if (typeof value !== "string" || !INSTANT.test(value)) return false;
  const at = Date.parse(value);
  // `Date` rolls a day or an hour that doesn't exist (30 February, 24:00) forward: read it back.
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 19) === value.slice(0, 19);
};

/** x402's usage, or `undefined` when the answer isn't its shape. */
function usageOf(value: unknown): X402Usage | undefined {
  if (!isObject(value) || !isObject(value.plan)) return undefined;
  const { used, remaining, limit, period_start, period_end, resets_at, as_of, plan } = value;
  // A plan has at least one payment: a limit of 0 would be a quota reached with no figures.
  return isCount(used) &&
    isCount(remaining) &&
    isCount(limit) &&
    limit >= 1 &&
    isTime(period_start) &&
    isTime(period_end) &&
    isTime(resets_at) &&
    isTime(as_of) &&
    typeof plan.name === "string" &&
    plan.name !== "" &&
    isCount(plan.quota_limit) &&
    plan.quota_period === "month"
    ? {
        used,
        remaining,
        limit,
        period_start,
        period_end,
        resets_at,
        as_of,
        plan: { name: plan.name, quota_limit: plan.quota_limit, quota_period: "month" },
      }
    : undefined;
}

/** `GET hub/x402/account`: the account's key and use. Read-only: opening the tab mints nothing. */
export async function fetchAccount(signal?: AbortSignal): Promise<X402Account> {
  const body = await call(ACCOUNT_URL, "GET", signal);
  const key = keyOf(body.key);
  if (!key) throw new HubError("unreadable", 200);
  const details: Record<string, unknown> = isObject(body.details) ? body.details : {};
  // Absent (or anything but a literal `true`) is "can't be shown": no Show key to fail on.
  const showable = details.showable === true;
  // A usage that isn't x402's shape reads as one x402 couldn't read: the card never shows zeros.
  const usage = details.usage === undefined ? undefined : (usageOf(details.usage) ?? null);
  return { key, showable, usage };
}

/** `POST hub/x402/key/reveal`: the key's value, for Show key and Copy key only. */
export async function revealKey(): Promise<{ key_id: string; value: string }> {
  const body = await call(REVEAL_URL, "POST");
  if (typeof body.key_id !== "string" || typeof body.value !== "string" || body.value === "") {
    throw new HubError("unreadable", 200);
  }
  return { key_id: body.key_id, value: body.value };
}

/**
 * `POST hub/x402/key/revoke`. Anything but `revoked: true` is not a revocation: the dialog must
 * never say "revoked" for a key that may still work.
 */
export async function revokeKey(): Promise<{ revoked_at?: string; next_eligible_at?: string }> {
  const body = await call(REVOKE_URL, "POST");
  if (body.revoked !== true || !isInstant(body.revoked_at) || !isInstant(body.next_eligible_at)) {
    throw new HubError("unreadable", 200);
  }
  return {
    revoked_at: typeof body.revoked_at === "string" ? body.revoked_at : undefined,
    next_eligible_at: typeof body.next_eligible_at === "string" ? body.next_eligible_at : undefined,
  };
}

/** The line for every failure that means x402 can't be reached or isn't on. */
export const UNAVAILABLE = "x402 is unavailable right now. Try again in a moment.";

/**
 * Codes (and the page's own) that mean x402 isn't there to ask: the one unavailable line.
 * `key_unavailable` is x402's own, its 502 when its key store is out of reach (`apps/portal` in
 * stellar-x402), which the hub passes on as it is.
 */
const UNAVAILABLE_CODES = new Set([
  "x402_unavailable",
  "x402_busy",
  "key_unavailable",
  "product_not_configured",
  "unknown_product",
  "timeout",
  "unreachable",
  "unreadable",
]);

/** Whether `cause` is the unavailable line's: x402 not answering, off, or not readable. */
export const isUnavailable = (cause: unknown) =>
  !(cause instanceof HubError) || UNAVAILABLE_CODES.has(cause.code);

/** Whether `cause` says the session has ended. */
export const isSignedOut = (cause: unknown) =>
  cause instanceof HubError && cause.code === "not_signed_in";

/** What each other failure means to the visitor, after "Could not …: ". */
const WORDS: Record<string, string> = {
  not_signed_in: "your session has ended — sign in again",
  bad_origin: "the request didn't come from this page — reload it and try again",
  no_key: "you have no API key",
  key_revoked: "your API key was revoked",
  rate_limited: "too many requests — wait a minute and try again",
  invalid_token:
    "x402 refused the hub's request — this is ours to fix, so tell us if it keeps happening",
  internal: "the hub failed — try again, and tell us if it keeps happening",
};

/**
 * A failed call in words, with its code after them for a support message. What is the unavailable
 * line's says that; a code it has no words for is x402's own, passed on by the hub.
 */
export function describeFailure(cause: unknown): string {
  const code = cause instanceof HubError ? cause.code : "unreadable";
  const words = UNAVAILABLE_CODES.has(code)
    ? UNAVAILABLE.slice(0, -1)
    : Object.hasOwn(WORDS, code)
      ? WORDS[code]
      : "x402 answered with an error — try again, and tell us if it keeps happening";
  return `${words} (${code})`;
}
