/**
 * The dashboard's dates and instants, in the words the page uses — moved from `app/app.tsx`
 * unchanged, so the Prices portal's dashboard and the hub's Prices tab (`src/account/prices`)
 * say a date the same way.
 */

/**
 * Render the date a revoked key's replacement can be issued (task 0191).
 *
 * The pattern `describeWait` deliberately avoids — a calendar date — is the
 * right one here, because the wait is weeks: "1 September 2026" is what a
 * visitor who revoked on 3 August needs to read. The value arrives from the
 * revoke answer, from the reveal's `key_revoked` envelope (RFC 3339) or from
 * the `?issue=capped` landing URL (`YYYY-MM-DD`); in every case it is OUR
 * instant — the 1st of the next month, 00:00 UTC, under the period rule the
 * backend states — so it is rendered in UTC and not in the viewer's zone,
 * where "1 September 00:00 UTC" can read as 31 August.
 *
 * Sanitised, because one of the sources is a URL: anything that is not a date
 * at the front renders as "the start of the next quota period", which is true
 * of every capped issue whatever the URL said.
 */
export function describeNextEligible(value: string | null | undefined): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return 'the start of the next quota period';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // `Date.UTC` does not reject an impossible month or day — it rolls them
  // over, so `2026-13-45` comes back as a real date in February 2027 rather
  // than `NaN`. Reading the fields back is what tells a date from garbage.
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return 'the start of the next quota period';
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Render an RFC 3339 instant as a UTC time — "21 August 2026, 12:00 UTC" —
 * for the revocation instant (task 0191). UTC, not the viewer's zone, for the
 * same reason as `describeNextEligible`.
 *
 * `null` for a missing or unparseable value, and the caller renders the
 * revocation WITHOUT an instant: the backend sends no `revoked_at` when no
 * record carries a date, and every stand-in reads as a statement of fact the
 * page cannot make — "deactivated on just now", or (worse, via the
 * next-eligible phrasing) "deactivated on the start of the next quota
 * period".
 */
export function describeUtcInstant(value: string | undefined): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const day = at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${day}, ${time} UTC`;
}

/**
 * The 1st of next month, in UTC — our quota period rule, computed.
 *
 * The backend states the same instant in `/usage`'s `resets_at`
 * (`portal/period.rs`), and the page prefers that value wherever it has it.
 * This is the fallback for the moment before that request answers, and it is
 * a computation rather than a guess: "the 1st of the month, 00:00 UTC" is OUR
 * definition, not something AWS reports (ADR 0010, correction #2).
 */
export function describeNextPeriodStart(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return next.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A key's timestamp as a plain UTC date — "13 April 2026".
 *
 * Date only, where `describeUtcInstant` gives date and time: the metadata row
 * states when a key came into being, and the minute it happened is noise
 * beside an id and an account. UTC for the reason task 0191 decision #15
 * gives: rendered in the viewer's zone, a key minted at 00:30 UTC on the 1st
 * would be dated to the previous month west of Greenwich.
 *
 * `null` for a missing or unparseable value, so the caller can drop the field
 * rather than print "Invalid Date".
 */
export function describeUtcDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * How long a disable takes to reach the data plane, in the words the page
 * uses. Measured under task 0180 item 8: a disabled key kept answering `200`
 * for ~25 s before the `403` arrived. Said out loud rather than hidden behind
 * "immediately", because a visitor revoking a LEAKED key is exactly the
 * person who must not stop worrying one second too early.
 */
export const PROPAGATION_COPY = 'within about half a minute';

/**
 * How long after a revocation the propagation window is still worth stating
 * in the present tense. The window is ~25 s; five minutes is generous and
 * keeps the copy honest on the reveal path, which renders the revoked view
 * on every page load — days later, "until then treat it as live" would be
 * telling somebody to keep worrying about a key that died last week.
 */
const PROPAGATION_FRESH_MS = 5 * 60 * 1000;

/** Whether `revokedAt` (RFC 3339) is recent enough for the present tense. */
export function revokedJustNow(revokedAt: string | undefined): boolean {
  if (!revokedAt) return false;
  const at = new Date(revokedAt).getTime();
  return !Number.isNaN(at) && Date.now() - at < PROPAGATION_FRESH_MS;
}

/** Whether `nextEligibleAt` (RFC 3339 or `YYYY-MM-DD`) is still ahead. */
export function stillWaiting(nextEligibleAt: string): boolean {
  const at = new Date(
    nextEligibleAt.length === 10
      ? `${nextEligibleAt}T00:00:00Z`
      : nextEligibleAt,
  );
  // An unparseable date is treated as STILL WAITING: the safe direction is
  // to withhold the issue link (the server would only refuse it), never to
  // offer it on garbage.
  return Number.isNaN(at.getTime()) || at.getTime() > Date.now();
}
