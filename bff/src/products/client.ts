/*
 * The hub's backend as a product's client (Prices, x402): the four calls of a product's hub
 * contract (the shared sign-in spec's "The dashboard contract"), each with a token of its own
 * (`token.ts`), and each answer made into one the page can read. The product's own error codes are
 * passed on; anything that isn't the product's answer (a gateway's, a CDN's, none at all) becomes
 * one of the hub's: `<product>_busy` or `<product>_unavailable`. No token, key or body is logged.
 */
import { randomBytes } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { mintToken, type Act, type TokenProduct } from "../token.ts";

/** How long a call to a product may take, the secret's read and its one retry included. */
export const PRODUCT_TIMEOUT_MS = 20_000;

/** Whom a call is for: the signed-in account, as the session names it. */
export interface Caller {
  discordId: string;
  /** The Discord username, for the product to name the account by. */
  name: string;
}

/** What a product's `key/issue` can answer. */
const ISSUE_OUTCOMES = ["issued", "has_key", "capped", "too_young", "failed"] as const;
export type IssueOutcome = (typeof ISSUE_OUTCOMES)[number];
export type IssueBody = { outcome: IssueOutcome; next_eligible_at?: string } & Record<
  string,
  unknown
>;

/**
 * A call's outcome. `ok`: the product's answer, a JSON object, for the page as it is. Otherwise
 * what the page is told instead, as `{"error": error, "details"?: details}` with `status`: the
 * product's own code and details, or the hub's `product_not_configured` (503), `<product>_busy`
 * (503) or `<product>_unavailable` (502).
 */
export type ProductAnswer<Body = Record<string, unknown>> =
  | { ok: true; body: Body }
  | {
      ok: false;
      status: ContentfulStatusCode;
      error: string;
      details?: Record<string, unknown>;
    };

export interface ProductClient {
  /** The account's key and its use: `GET account`, `act` read. */
  account(caller: Caller): Promise<ProductAnswer>;
  /** The key itself: `POST key/reveal`. */
  reveal(caller: Caller): Promise<ProductAnswer>;
  /** Revokes the key: `POST key/revoke`. */
  revoke(caller: Caller): Promise<ProductAnswer>;
  /**
   * Asks for a key: `POST key/issue`. Only after the gates, from the issue's callback, which may
   * give it less than {@link PRODUCT_TIMEOUT_MS}: `timeoutMs`, what the callback has left.
   */
  issue(caller: Caller, timeoutMs?: number): Promise<ProductAnswer<IssueBody>>;
}

export interface ProductClientOptions {
  /**
   * The token's product, and the prefix of `<product>_busy`, `<product>_unavailable` and of the
   * log events.
   */
  product: TokenProduct;
  /** The product's name in a log line's words: "Prices", "x402". */
  label: string;
  /** The product's hub contract, with no trailing slash: a call goes to `${api}/account`. */
  api: string;
  /**
   * The secret the tokens are signed with (`productSecret`). When it rejects, the call answers
   * `product_not_configured` and logs nothing, the reader logged why, but for an issue, which is
   * logged with its account. When it hasn't resolved by the call's deadline, the same answer,
   * logged here.
   */
  signer: () => Promise<Buffer>;
  fetchImpl?: typeof globalThis.fetch;
  /** The clock tokens are dated by, in milliseconds. */
  now?: () => number;
}

/** One call of the contract. */
interface Call {
  method: "GET" | "POST";
  path: string;
  act: Act;
  /** What a successful answer is logged as, if it is a key event. */
  event?: (body: Record<string, unknown>) => string;
  /** Whether a successful answer says what the call needs it to. */
  holds?: (body: Record<string, unknown>) => boolean;
  /**
   * A key event: its failure is logged with the account whatever the cause, even a secret whose
   * reader has said why, so that every failed issue is on record by account. Logged here only,
   * once: the callback adds no line of its own.
   */
  keyEvent?: true;
}

/** The four calls, with the key events they log under `product`'s prefix. */
const callsOf = (product: TokenProduct) =>
  ({
    account: { method: "GET", path: "/account", act: "read" },
    reveal: {
      method: "POST",
      path: "/key/reveal",
      act: "reveal",
      event: () => `${product}_key_revealed`,
    },
    revoke: {
      method: "POST",
      path: "/key/revoke",
      act: "revoke",
      event: () => `${product}_key_revoked`,
    },
    issue: {
      method: "POST",
      path: "/key/issue",
      act: "issue",
      event: (body) => `${product}_key_issue ${String(body.outcome)}`,
      holds: (body) => (ISSUE_OUTCOMES as readonly unknown[]).includes(body.outcome),
      keyEvent: true,
    },
  }) as const satisfies Record<string, Call>;

/** `ms` in seconds, as a log line says it: `20`, `7.5`. */
const seconds = (ms: number) => String(Math.round(ms / 100) / 10);

const NOT_CONFIGURED = { ok: false, status: 503, error: "product_not_configured" } as const;

/** A code as a product writes its own: snake_case, so it can be passed on and logged as it is. */
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * A product's 404s that are the account's state, not a failure: passed on as 409, since the CDN in
 * front of the hub turns every 404 into another page. Any other 404 is a route the product doesn't
 * have, a fault between the two backends.
 */
const KEY_STATES: readonly string[] = ["no_key", "key_revoked"];
/**
 * A product's 409s that are the account's state too: x402 keeps no copy of a key issued by hand,
 * so there is none to show. Passed on as it is.
 */
const KEY_STATES_AS_409: readonly string[] = ["key_not_viewable"];
/** The one code whose `details` reach the page: when the key was revoked, when a new one can be. */
const WITH_DETAILS = "key_revoked";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A product's error envelope's code and details, or `undefined` for any other body. */
function envelopeOf(
  body: unknown,
): { code: string; details?: Record<string, unknown> } | undefined {
  if (!isObject(body) || typeof body.code !== "string" || !CODE.test(body.code)) return undefined;
  return isObject(body.details) ? { code: body.code, details: body.details } : { code: body.code };
}

/**
 * The status a product's error is passed on with: its own, but for two kinds. A 401 or 403 is
 * the product refusing the hub's token or its act, a fault between the two backends and not the
 * visitor's, which the page would otherwise read as "not signed in": 502. A 404 is one of
 * {@link KEY_STATES} by now: 409.
 */
function passedOn(status: number): ContentfulStatusCode {
  if (status === 401 || status === 403) return 502;
  if (status === 404) return 409;
  return status as ContentfulStatusCode;
}

/**
 * `promise`, or a rejection once `signal` aborts, whichever comes first. Its listener goes with
 * it, and a rejection of `promise` after the abort is taken here, not left unhandled.
 */
function beforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    if (signal.aborted) aborted();
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

/** A body as JSON, or `undefined` when it isn't. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** {@link ProductClient} over HTTPS, one call at a time. */
export function productClient({
  product,
  label,
  api,
  signer,
  fetchImpl = globalThis.fetch,
  now = Date.now,
}: ProductClientOptions): ProductClient {
  const CALLS = callsOf(product);
  const BUSY = { ok: false, status: 503, error: `${product}_busy` } as const;
  const UNAVAILABLE = { ok: false, status: 502, error: `${product}_unavailable` } as const;
  async function call(
    caller: Caller,
    { method, path, act, event, holds, keyEvent }: Call,
    timeoutMs = PRODUCT_TIMEOUT_MS,
  ): Promise<ProductAnswer> {
    // One deadline for the whole call, from here: the secret's read can take seconds of its own.
    const limit = Math.min(timeoutMs, PRODUCT_TIMEOUT_MS);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), limit);
    try {
      let secret: Buffer;
      try {
        secret = await beforeAbort(signer(), controller.signal);
      } catch {
        // A read that failed was logged by the reader, without the account a key event needs;
        // one still under way has said nothing yet.
        const why = controller.signal.aborted
          ? `the secret was not read in ${seconds(limit)} s`
          : keyEvent && "the secret could not be read";
        if (why) console.warn(`${product}_call_failed ${act} discord:${caller.discordId} (${why})`);
        return NOT_CONFIGURED;
      }

      for (let attempt = 1; ; attempt += 1) {
        // A token for each request, a retry's too: one token, one call.
        const jti = randomBytes(16).toString("base64url");
        const token = mintToken(secret, {
          product,
          discordId: caller.discordId,
          name: caller.name,
          act,
          now: now(),
          jti,
        });
        const about = `${act} discord:${caller.discordId} jti:${jti}`;
        const failed = (answer: ProductAnswer, why: string) => {
          console.warn(`${product}_call_failed ${about} (${why})`);
          return answer;
        };

        let status: number;
        let body: unknown;
        try {
          const response = await fetchImpl(`${api}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            redirect: "manual",
            signal: controller.signal,
          });
          status = response.status;
          body = parsed(await response.text());
        } catch (error) {
          // The error's name tells a refused connection from a reset; its message is not read.
          return failed(
            UNAVAILABLE,
            controller.signal.aborted
              ? `${label} did not answer in ${seconds(limit)} s`
              : `could not reach ${label}: ${error instanceof Error ? error.name : "a failure"}`,
          );
        }

        if (status >= 200 && status < 300) {
          if (!isObject(body)) {
            return failed(UNAVAILABLE, `${label} answered ${status} without a JSON object`);
          }
          if (holds && !holds(body)) {
            return failed(UNAVAILABLE, `${label} answered ${status} without a known outcome`);
          }
          if (event) console.info(`${event(body)} discord:${caller.discordId} jti:${jti}`);
          return { ok: true, body };
        }

        const envelope = status >= 400 ? envelopeOf(body) : undefined;
        const said = envelope
          ? `${label} answered ${status} ${envelope.code}`
          : `${label} answered ${status} without its error envelope`;
        if (status === 503 && attempt === 1) {
          console.warn(`${product}_call_retried ${about} (${said})`);
          continue;
        }
        if (!envelope) return failed(status === 429 ? BUSY : UNAVAILABLE, said);
        const keyState =
          (status === 404 && KEY_STATES.includes(envelope.code)) ||
          (status === 409 && KEY_STATES_AS_409.includes(envelope.code));
        if (status === 404 && !keyState) return failed(UNAVAILABLE, said);
        const answer: ProductAnswer = {
          ok: false,
          status: passedOn(status),
          error: envelope.code,
          ...(envelope.code === WITH_DETAILS && envelope.details
            ? { details: envelope.details }
            : {}),
        };
        if (!keyState) return failed(answer, said);
        // The account has no key to show or revoke: an answer, not a failed call.
        console.info(`${product}_call_answered ${about} (${said})`);
        return answer;
      }
    } finally {
      clearTimeout(deadline);
    }
  }

  return {
    account: (caller) => call(caller, CALLS.account),
    reveal: (caller) => call(caller, CALLS.reveal),
    revoke: (caller) => call(caller, CALLS.revoke),
    issue: (caller, timeoutMs) =>
      call(caller, CALLS.issue, timeoutMs) as Promise<ProductAnswer<IssueBody>>,
  };
}
