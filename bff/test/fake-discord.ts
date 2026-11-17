import { createHash } from "node:crypto";
import { DiscordError, type Discord, type MemberAnswer } from "../src/discord.ts";

/** A Discord id: Discord's own example, an account from 2016. */
export const ACCOUNT_ID = "175928847299117063";
export const BOTH_SCOPES = "identify guilds.members.read";

/**
 * Discord, in memory, answering as each test sets it. As the real one does, it takes a code back
 * only with the PKCE verifier whose S256 challenge the sign-in carried, and with the same callback
 * address. A code can be exchanged more than once here, unlike at Discord, so a callback that
 * reaches the exchange twice is the hub's doing, not stopped by the fake.
 */
export class FakeDiscord implements Discord {
  /** Whose account a code signs in. */
  account = { id: ACCOUNT_ID, username: "member" };
  /** The scopes a token comes with. */
  scope = BOTH_SCOPES;
  /** What the membership lookup answers, or an error it throws. */
  memberAnswer: MemberAnswer | Error = "member";
  /** Set to make the exchange or the account lookup fail as Discord's own failure would. */
  failExchange = false;
  failUser = false;

  /** Every exchange that was attempted, and every membership lookup with its token and guild. */
  readonly exchanges: string[] = [];
  readonly memberLookups: { token: string; guildId: string }[] = [];

  private readonly started = new Map<string, { challenge: string; redirectUri: string }>();
  private readonly codes = new Map<string, { challenge: string; redirectUri: string }>();

  authorizeUrl(request: { state: string; challenge: string; redirectUri: string }): string {
    this.started.set(request.state, {
      challenge: request.challenge,
      redirectUri: request.redirectUri,
    });
    const url = new URL("https://discord.test/oauth2/authorize");
    url.searchParams.set("state", request.state);
    return url.toString();
  }

  /** The code Discord would send back for the sign-in that carried `state`. */
  codeFor(state: string): string {
    const code = `the-code-${this.codes.size + 1}`;
    const started = this.started.get(state);
    if (started) this.codes.set(code, started);
    return code;
  }

  /** The access token a code is exchanged for. */
  tokenFor(code: string): string {
    return `the-access-token-for-${code}`;
  }

  exchange(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; scope: string }> {
    this.exchanges.push(code);
    const started = this.codes.get(code);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      this.failExchange ||
      !started ||
      started.challenge !== challenge ||
      started.redirectUri !== redirectUri
    ) {
      return Promise.reject(new DiscordError("Discord answered 400 to exchange the code"));
    }
    return Promise.resolve({ accessToken: this.tokenFor(code), scope: this.scope });
  }

  user(token: string): Promise<{ id: string; username: string }> {
    if (this.failUser || !token.startsWith("the-access-token-for-")) {
      return Promise.reject(new DiscordError("Discord answered 401 to read the account"));
    }
    return Promise.resolve({ ...this.account });
  }

  member(token: string, guildId: string): Promise<MemberAnswer> {
    this.memberLookups.push({ token, guildId });
    const answer = this.memberAnswer;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }
}
