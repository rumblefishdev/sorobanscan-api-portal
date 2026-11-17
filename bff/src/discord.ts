/*
 * From stellar-x402's `apps/portal/src/discord.ts` at 4157f642 (Apache-2.0, same organisation).
 * Changed: the callback address is passed with each call instead of fixed; `exchange` hands the
 * granted scopes back for the caller to check; the membership answer is one word, with x402's
 * `decide` (`eligibility.ts`) folded in for `pending`; no `prompt`.
 */
import type { HubSettings } from "./settings.ts";

/** What the hub asks Discord for, and all it accepts being granted. */
export const SCOPE = "identify guilds.members.read";

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const API_BASE = "https://discord.com/api";
/** One request's limit. A sign-in makes three, inside a browser's redirect. */
const REQUEST_TIMEOUT_MS = 4_000;
/** Discord's answers to "is this account in the guild" that mean no: Unknown Member, Unknown Guild. */
const NOT_MEMBER_CODES = [10_007, 10_004];

const SNOWFLAKE = /^[0-9]{1,20}$/;

export const isSnowflake = (value: unknown): value is string =>
  typeof value === "string" && SNOWFLAKE.test(value);

/**
 * Whether an account is in the guild:
 * - `member`: a member who has cleared Membership Screening (`pending: false`);
 * - `pending`: a member who hasn't accepted the guild's rules yet;
 * - `not_member`: Discord said it isn't one;
 * - `unknown`: Discord didn't say (an outage, a rate limit, a rejected token, an answer of
 *   another shape, a member answer without `pending`). Never a "no".
 */
export type MemberAnswer = "member" | "pending" | "not_member" | "unknown";

/** A sign-in step Discord didn't complete. Its message names the step and never a token or a body. */
export class DiscordError extends Error {
  override readonly name = "DiscordError";
}

/** The four things the hub does at Discord. The token it gets is used and dropped, never kept. */
export interface Discord {
  /** Where the browser goes to sign in. */
  authorizeUrl(p: { state: string; challenge: string; redirectUri: string }): string;
  /**
   * Exchanges a callback's `code` for an access token, with the scopes Discord granted it.
   * Throws a {@link DiscordError}.
   */
  exchange(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; scope: string }>;
  /** Whose token it is. Throws a {@link DiscordError}. */
  user(token: string): Promise<{ id: string; username: string }>;
  /** Whether that account is a member of `guildId`. What it can't tell is `unknown`. */
  member(token: string, guildId: string): Promise<MemberAnswer>;
}

/** {@link Discord} over HTTPS. */
export function httpDiscord(
  settings: Pick<HubSettings, "discordClientId" | "discordClientSecret">,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Discord {
  /** A request to Discord's API that fails as a {@link DiscordError} naming only the step. */
  const request = async (step: string, path: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(`${API_BASE}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DiscordError(`could not reach Discord to ${step}`, { cause: error });
    }
  };
  const json = async (step: string, response: Response): Promise<Record<string, unknown>> => {
    // The body of a failure is never read into a message: it can echo what was sent.
    if (!response.ok) throw new DiscordError(`Discord answered ${response.status} to ${step}`);
    const body: unknown = await response.json().catch(() => undefined);
    if (typeof body !== "object" || body === null) {
      throw new DiscordError(`Discord's answer to ${step} was not an object`);
    }
    return body as Record<string, unknown>;
  };
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

  return {
    authorizeUrl({ state, challenge, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: settings.discordClientId,
        scope: SCOPE,
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return url.toString();
    },

    async exchange(code, verifier, redirectUri) {
      const step = "exchange the code";
      const response = await request(step, "/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: settings.discordClientId,
          client_secret: settings.discordClientSecret,
          code_verifier: verifier,
        }),
      });
      const body = await json(step, response);
      if (typeof body.access_token !== "string" || body.access_token === "") {
        throw new DiscordError("Discord's token answer held no access token");
      }
      return {
        accessToken: body.access_token,
        scope: typeof body.scope === "string" ? body.scope : "",
      };
    },

    async user(token) {
      const step = "read the account";
      const body = await json(step, await request(step, "/users/@me", bearer(token)));
      if (!isSnowflake(body.id) || typeof body.username !== "string") {
        throw new DiscordError("Discord's account answer held no id or no username");
      }
      return { id: body.id, username: body.username };
    },

    async member(token, guildId) {
      let response: Response;
      try {
        response = await request(
          "read the membership",
          `/users/@me/guilds/${guildId}/member`,
          bearer(token),
        );
      } catch {
        return "unknown";
      }
      const body: unknown = await response.json().catch(() => undefined);
      const fields =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      if (response.ok) {
        // `pending` is Membership Screening: `true` until the account accepted the guild's
        // rules. An answer that doesn't say is not taken for a cleared screening.
        if (fields.pending === false) return "member";
        if (fields.pending === true) return "pending";
        return "unknown";
      }
      // Only a 404 with a code that says so is "not a member": a bare 404 can be a proxy's or an
      // outage's, and telling a member they aren't one is the worse mistake.
      if (response.status === 404 && NOT_MEMBER_CODES.includes(fields.code as number)) {
        return "not_member";
      }
      return "unknown";
    },
  };
}
