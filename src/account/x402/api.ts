import { HUB } from "../session";
import {
  call,
  HubError,
  isInstant,
  isObject,
  ISSUE_URL as PRICES_ISSUE_URL,
  keyIsGone,
} from "../prices/api";

/**
 * The x402 tab's calls, all to the hub's backend (`bff/src/products/x402.ts`), which signs a token
 * for each and asks x402's hub contract: the page never calls x402. The same transport as the
 * Prices tab's (`../prices/api.ts`: the timeout, the non-JSON answer, the `HubError`), under
 * `hub/x402/`.
 */

const X402 = `${HUB}x402/`;
const ACCOUNT_URL = `${X402}account`;
const REVEAL_URL = `${X402}key/reveal`;
const REVOKE_URL = `${X402}key/revoke`;

/** "Get API Key": the hub's one issue route, a form `POST` with `product=x402`. */
export const ISSUE_URL = PRICES_ISSUE_URL;

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

/** x402's `account`: the key, and whether `key/reveal` can show it (`details.showable`). */
export interface X402Account {
  key: X402Key;
  showable: boolean;
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

/** `GET hub/x402/account`: the account's key. Read-only: opening the tab mints nothing. */
export async function fetchAccount(signal?: AbortSignal): Promise<X402Account> {
  const body = await call(ACCOUNT_URL, "GET", signal);
  const key = keyOf(body.key);
  if (!key) throw new HubError("unreadable", 200);
  // Absent (or anything but a literal `true`) is "can't be shown": no Show key to fail on.
  const showable = isObject(body.details) && body.details.showable === true;
  return { key, showable };
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

/** Codes (and the page's own) that mean x402 isn't there to ask: the one unavailable line. */
const UNAVAILABLE_CODES = new Set([
  "x402_unavailable",
  "x402_busy",
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
