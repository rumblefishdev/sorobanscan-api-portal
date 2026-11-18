import type { PortalRevocation, PortalUsage } from "../../prices/api/portal";
import { HUB } from "../session";

/**
 * The Prices tab's calls, all to the hub's backend (`bff/src/products/prices.ts`), which signs a
 * token of its own for each and asks Prices' hub contract: the page never calls Prices. The same
 * data the Prices portal's dashboard read from `/api/key`, `/api/usage` and `/api/config`, now
 * from one `account` call.
 */

const PRICES = `${HUB}prices/`;
const ACCOUNT_URL = `${PRICES}account`;
const REVEAL_URL = `${PRICES}key/reveal`;
const REVOKE_URL = `${PRICES}key/revoke`;

/**
 * "Get API Key": a form's `POST` here, with `product=prices`, from this page. The backend starts a
 * silent round trip through Discord and lands back on the tab with `?issue=<outcome>`.
 */
export const ISSUE_URL = `${HUB}auth/issue`;

/**
 * How long the tab waits for the hub. Past the hub's own 20 s for a call to Prices, so its answer
 * (`prices_unavailable`, say) is what the page shows rather than its own timeout; and as long as
 * CloudFront waits for the hub, past which no answer comes.
 */
export const HUB_TIMEOUT_MS = 30_000;

/** The account's key, as Prices' `account` states it. Its instants are RFC 3339. */
export type PricesKey =
  | { state: "none"; can_issue: boolean; next_eligible_at?: string | null }
  | {
      state: "active";
      key_id: string;
      created_at?: string | null;
      last_updated_at?: string | null;
      can_issue: boolean;
    }
  | {
      state: "revoked";
      revoked_at?: string | null;
      next_eligible_at?: string | null;
      can_issue: boolean;
    };

/**
 * Prices' `account`: the key, and the account's use this period. `null` when Prices gave none,
 * which beside an `active` key means its read of the usage failed (the hub's contract).
 */
export interface PricesAccount {
  key: PricesKey;
  usage: PortalUsage | null;
}

/** The key itself, from `key/reveal`. */
export interface RevealedKey {
  key_id: string;
  value: string;
}

/**
 * A call the hub didn't answer with what was asked. `code` is the hub's (or Prices', passed on)
 * `error`, or the page's own: `timeout`, `unreachable` or `unreadable` (an answer that isn't the
 * hub's JSON, such as the CDN's page for a 403 or 404, which it serves with 200).
 */
export class HubError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = "HubError";
  }
}

/** A code the page names a failure by: snake_case, as the hub and Prices write theirs. */
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One call to the hub, the session's cookie with it: its JSON object, or a {@link HubError}. A
 * `POST` from this page names its origin, which the hub requires of every `POST`.
 */
export async function call(
  url: string,
  method: "GET" | "POST",
  /** The caller's own way to stop waiting (the x402 tab's), besides the deadline below. */
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const asking = new AbortController();
  const stop = () => asking.abort();
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  // A timer, not `AbortSignal.timeout`: it stops with the call it belongs to.
  const deadline = setTimeout(() => asking.abort(), HUB_TIMEOUT_MS);
  try {
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: asking.signal,
      });
      body = await response.json().catch(() => undefined);
    } catch {
      throw new HubError(asking.signal.aborted ? "timeout" : "unreachable");
    }
    if (response.ok) {
      if (!isObject(body)) throw new HubError("unreadable", response.status);
      return body;
    }
    const code = isObject(body) && typeof body.error === "string" ? body.error : undefined;
    throw new HubError(code && CODE.test(code) ? code : "unreadable", response.status);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", stop);
  }
}

export const isInstant = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";

/** Prices' key, or `undefined` when the answer isn't one of its three states. */
function keyOf(value: unknown): PricesKey | undefined {
  if (!isObject(value) || typeof value.can_issue !== "boolean") return undefined;
  const { can_issue } = value;
  switch (value.state) {
    case "none":
      return isInstant(value.next_eligible_at)
        ? { state: "none", can_issue, next_eligible_at: value.next_eligible_at }
        : undefined;
    case "active":
      return typeof value.key_id === "string" &&
        isInstant(value.created_at) &&
        isInstant(value.last_updated_at)
        ? {
            state: "active",
            key_id: value.key_id,
            created_at: value.created_at,
            last_updated_at: value.last_updated_at,
            can_issue,
          }
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

/** `GET hub/prices/account`: the account's key and its use. Read-only: opening the tab mints nothing. */
export async function fetchAccount(): Promise<PricesAccount> {
  const body = await call(ACCOUNT_URL, "GET");
  const key = keyOf(body.key);
  const details = body.details;
  if (!key || !isObject(details)) throw new HubError("unreadable", 200);
  const usage = details.usage;
  // Prices' `UsageResponse` as it is (`PortalUsage`): the cards read it as the portal's did.
  if (usage !== null && !(isObject(usage) && typeof usage.as_of === "string")) {
    throw new HubError("unreadable", 200);
  }
  return { key, usage: usage as PortalUsage | null };
}

/** `POST hub/prices/key/reveal`: the key's value, for Show key and Copy key only. */
export async function revealKey(): Promise<RevealedKey> {
  const body = await call(REVEAL_URL, "POST");
  if (typeof body.key_id !== "string" || typeof body.value !== "string" || body.value === "") {
    throw new HubError("unreadable", 200);
  }
  return { key_id: body.key_id, value: body.value };
}

/**
 * `POST hub/prices/key/revoke`: Prices' revocation, as the Regenerate dialog takes it. Anything
 * but `revoked: true` with a date is not a revocation: the dialog must never say "revoked" for a
 * key that may still work.
 */
export async function revokeKey(): Promise<PortalRevocation> {
  const body = await call(REVOKE_URL, "POST");
  if (
    body.revoked !== true ||
    typeof body.next_eligible_at !== "string" ||
    !isInstant(body.revoked_at)
  ) {
    throw new HubError("unreadable", 200);
  }
  return {
    revoked: true,
    next_eligible_at: body.next_eligible_at,
    revoked_at: typeof body.revoked_at === "string" ? body.revoked_at : undefined,
    // Only a literal `true` adds the warning.
    partial: body.partial === true,
  };
}

/** What each failure means to the visitor, after "Could not …: ". */
const WORDS: Record<string, string> = {
  not_signed_in: "your session has ended — sign in again",
  product_not_configured:
    "the hub can't reach the Prices API on this server: its credentials for Prices are not available",
  prices_unavailable: "the Prices API did not answer — try again in a moment",
  prices_busy: "the Prices API is busy right now — try again in a moment",
  invalid_token:
    "the Prices API refused the hub's request — this is ours to fix, so tell us if it keeps happening",
  unknown_product: "this server doesn't offer the Prices API tab",
  bad_origin: "the request didn't come from this page — reload it and try again",
  no_key: "you have no API key",
  key_revoked: "your API key was revoked",
  internal: "the hub failed — try again, and tell us if it keeps happening",
  timeout: `the hub didn't answer within ${HUB_TIMEOUT_MS / 1000} seconds — try again`,
  unreachable: "the hub could not be reached — check your connection and try again",
  unreadable:
    "the hub answered in a way this page can't read — try again, and tell us if it keeps happening",
};

/**
 * A failed call in words, with its code after them for a support message: "the Prices API is busy
 * right now — try again in a moment (prices_busy)". A code it has no words for is one of Prices'
 * own, passed on by the hub.
 */
export function describeFailure(cause: unknown): string {
  const code = cause instanceof HubError ? cause.code : "unreadable";
  // Own keys only: `constructor` is a code's shape too.
  const words = Object.hasOwn(WORDS, code)
    ? WORDS[code]
    : "the Prices API answered with an error — try again, and tell us if it keeps happening";
  return `${words} (${code})`;
}

/** Whether `cause` says the key the page holds is gone: the account is to be read again. */
export const keyIsGone = (cause: unknown) =>
  cause instanceof HubError && (cause.code === "no_key" || cause.code === "key_revoked");
