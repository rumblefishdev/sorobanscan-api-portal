import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { STELLAR_DISCORD_INVITE, STELLAR_DISCORD_SERVER } from "../../prices/landing/links";
import { describeNextEligible } from "../../prices/dashboard/dates";

/**
 * How a "Get API Key" round trip ended, as the hub's backend lands it on the tab in `?issue=`:
 * Prices' own outcome (`issued`, `has_key`, `capped`, `too_young`, `failed`) or why Prices wasn't
 * asked (the plan's Global Constraints list them). `busy` is the backend's limit on its sign-in
 * routes, which lands on the sign-in page instead (`useIssueWindow`).
 */
const OUTCOMES = [
  "issued",
  "has_key",
  "capped",
  "too_young",
  "not_member",
  "pending_rules",
  "unknown",
  "failed",
  "account_mismatch",
  "cancelled",
  "busy",
] as const;
export type IssueOutcome = (typeof OUTCOMES)[number];

const isOutcome = (value: string | null): value is IssueOutcome =>
  (OUTCOMES as readonly (string | null)[]).includes(value);

/** The outcome an `?issue=` value names, or `null` for one this page doesn't know. */
export const issueOutcomeOf = (value: string | null): IssueOutcome | null =>
  isOutcome(value) ? value : null;

/**
 * `?issue=`, read once and taken off the address, as the Prices portal's `useOneShotParams` does:
 * the outcome stays on screen for this visit, and a reload, a bookmark or Back shows no stale
 * banner. `replace`, so the stripped address takes the entry's place. A value it doesn't know is
 * taken off too, and shows nothing.
 */
export function useIssueOutcome(): IssueOutcome | null {
  const [searchParams, setSearchParams] = useSearchParams();
  // Captured once per mount; StrictMode's rehearsal keeps state, so the capture survives it.
  const [outcome] = useState(() => issueOutcomeOf(searchParams.get("issue")));
  const present = searchParams.has("issue");
  const stripped = useRef(false);
  useEffect(() => {
    if (!present || stripped.current) return;
    stripped.current = true;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("issue");
        return next;
      },
      { replace: true },
    );
  }, [present, setSearchParams]);
  return outcome;
}

/**
 * The outcome in words, at the top of the API Key card: the Prices portal's for the same outcome
 * (`ApiKey` in `src/prices/app/app.tsx`), word for word, where it has them. Two changes run
 * through them: Prices' "try again" was a link into its issue round trip, and here it is plain
 * words over the card's own "Get API Key", a form, since an issue starts only from a `POST`; and
 * `too_young` names no wait, since the hub's landing carries none. `has_key` and
 * `account_mismatch` are the hub's: Prices' sign-in issued a key, so it had neither.
 *
 * `issued` is the key card's to say (it depends on whether the key is listed yet), so it renders
 * nothing here.
 *
 * Each is a live region, so a screen reader says it when the tab draws it: `status` where nothing
 * is wrong (a key is there, or the visitor stopped), `alert` where no key was issued and something
 * stands in the way, as Prices' own "Copied." and failed revoke are.
 */
export function IssueBanner({
  outcome,
  username,
  nextEligibleAt,
  period = "quota period",
  describeDate = describeNextEligible,
}: {
  outcome: IssueOutcome | null;
  /** The signed-in account, for `account_mismatch`. */
  username: string;
  /**
   * When a capped account can have a key again, from its account; `undefined` while the account
   * hasn't been read, when `capped` waits rather than state a date it will take back.
   */
  nextEligibleAt: string | null | undefined;
  /** What the rule counts in, for `capped`: Prices' "quota period", x402's "calendar month". */
  period?: string;
  /** The date, for `capped`; Prices' own by default. */
  describeDate?: (value: string | null | undefined) => string;
}) {
  switch (outcome) {
    case "has_key":
      return (
        <p data-testid="issue-has-key" role="status">
          You already have an API key, so no new one was issued: it is below.
        </p>
      );
    case "capped":
      if (nextEligibleAt === undefined) return null;
      return (
        <p data-testid="issue-capped" role="alert">
          No new key yet: you deactivated your previous key this {period}, and a replacement can
          be issued from <strong>{describeDate(nextEligibleAt)}</strong>. Until then you do
          not have a working key.
        </p>
      );
    case "too_young":
      return (
        <p data-testid="issue-too-young" role="alert">
          Your Discord account is too new to get an API key — this is a short wait, not a
          rejection. Try again in a few minutes.
        </p>
      );
    // The two Discord links open a new tab, as Prices' do: the outcome is already off the
    // address, so a visitor who left this tab for Discord and came Back would find it gone.
    case "not_member":
      return (
        <p data-testid="issue-not-member" role="alert">
          You need to be a member of the{" "}
          <a href={STELLAR_DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
            Stellar Developers Discord
          </a>{" "}
          to get an API key — joining is an open invite. Once you are in, try again.
        </p>
      );
    case "pending_rules":
      return (
        <p data-testid="issue-pending-rules" role="alert">
          Your Discord account is on the{" "}
          <a href={STELLAR_DISCORD_SERVER} target="_blank" rel="noopener noreferrer">
            Stellar Developers Discord
          </a>
          , but you have not accepted the server&apos;s rules yet. Accept them on Discord, then try
          again.
        </p>
      );
    case "unknown":
      return (
        <p data-testid="issue-unknown" role="alert">
          We could not verify your Discord membership just now — that is a problem talking to
          Discord, not a statement about your membership. Please try again shortly.
        </p>
      );
    case "failed":
      return (
        <p data-testid="issue-failed" role="alert">
          We could not create your key. This is our key service, not your Discord membership.
          Please try again, and tell us if it keeps happening.
        </p>
      );
    case "cancelled":
      return (
        <p data-testid="issue-cancelled" role="status">
          You stopped before Discord could check your membership — nothing was created, and nothing
          is wrong. Pick it up again whenever you like.
        </p>
      );
    // Discord answered for another account than this browser's session: Discord signs in
    // whichever account it has a session for.
    case "account_mismatch":
      return (
        <p data-testid="issue-account-mismatch" role="alert">
          Discord answered for another account than <strong>{username}</strong>, the one signed in
          here, so no key was issued. Switch back to {username} on Discord and try again, or sign
          out and sign in with the other account.
        </p>
      );
    // The backend refused the round trip before Discord, over its limit on the sign-in routes from
    // one address: the sign-in page's line for it (`TooManyAttempts` in `LoginPage.tsx`).
    case "busy":
      return (
        <p data-testid="issue-busy" role="alert">
          Too many sign-in attempts from your network. Try again in a minute.
        </p>
      );
    default:
      return null;
  }
}
