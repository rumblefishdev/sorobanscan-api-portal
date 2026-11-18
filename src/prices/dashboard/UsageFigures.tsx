/**
 * The usage card's figures once Prices has answered with the key's usage (task 0188's figures,
 * task 0193's meter, task 0311's plan states) — the `ok` branch of `Usage` in `app/app.tsx`,
 * moved unchanged, so the Prices portal's dashboard and the hub's Prices tab
 * (`src/account/prices`) state a key's usage from one copy.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { PortalUsage } from '../api/portal';
import { NoticeStrip, UsageMeter } from '../landing/DashboardPanel';
import { color } from '../theme/tokens';
import { Figure, UNDERLINED } from './parts';
import { quotaLabel } from './plan';

/**
 * The quota-reached notice — task 0193, from the `Dashboard - limits` frame.
 *
 * The card above it already says *how much* is gone (100,000 of 100,000, a red
 * bar, "0 remaining"). None of that says what a developer at the ceiling
 * actually needs to know, which is what their integration is doing RIGHT NOW:
 * every request is being refused with `429` until the reset. A spent bar is a
 * fact about the past; this is the consequence, and it is the reason the state
 * gets its own strip instead of just a colour change.
 *
 * **New copy, and it belongs to this slice.** The brief's rule is that 0193
 * re-decides no wording another task owns, and this wording is not owned: the
 * quota-reached state is not in [[0188]]'s panel (which stops at three figures
 * and a reset rule) nor in [[0191]]'s revoke flow. The date and the status code
 * are both restatements of things already decided elsewhere — the reset rule is
 * 0188's, `HTTP 429` on throttle is the Rate Limit card's constant — and
 * neither is re-worded here, only repeated where it now bites.
 *
 * "Contact us" is plain text here. Since task 0311 there IS a destination —
 * the Rate Limit card's tiered contact link two columns away points at
 * `RUMBLEFISH_CONTACT` — and this strip's copy is left as it was (0311 scopes
 * its contact change to that card).
 */
function QuotaReachedNotice({
  resetsAt,
  period,
}: {
  resetsAt: string;
  /** The plan's `quota_period` — the notice names it (task 0311, WR-02). */
  period?: string | null;
}) {
  const at = new Date(resetsAt);
  const on = Number.isNaN(at.getTime())
    ? null
    : at.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });

  return (
    <NoticeStrip tone="error">
      <p data-testid="usage-quota-reached">
        {quotaLabel(period)} reached. API requests will return{' '}
        <strong>HTTP 429</strong>
        {/* The date is dropped rather than guessed if `resets_at` is
            unparseable: the sentence still says what is happening and when it
            stops being true is simply left unsaid, which beats "resets on
            Invalid Date" on the one card a cut-off developer is reading. */}
        {on ? <> until the quota resets on {on}</> : ' until the quota resets'}.{' '}
        {/* `<strong>`, so it takes the strip's emphasis colour (#e7000b) from
            the one place that decides it, rather than naming the hex a second
            time here — the same treatment `HTTP 429` gets, because the frame
            gives the two the same weight. Still underlined and still a
            `<span>` inside it and not an `<a>`: the link to
            `RUMBLEFISH_CONTACT` is the Rate Limit card's (task 0311). */}
        <strong>
          <Box component="span" sx={{ ...UNDERLINED, color: 'inherit' }}>
            Contact us for higher limits.
          </Box>
        </strong>
      </p>
    </NoticeStrip>
  );
}

/**
 * The reset caption, under the bar and left-aligned — "Resets 1 September".
 *
 * ⚠️ **This replaces two lines task 0188 decided**, at Adam's instruction on
 * 2026-08-25: the "Quota resets on the 1st of each month, 00:00 UTC — next
 * reset …" sentence and the "Last updated … AWS reports usage with a delay"
 * line, along with the Refresh button beside them. The frame has none of the
 * three, and the space they occupied is where task [[0232]]'s daily chart
 * goes.
 *
 * What is lost with them is 0188's lag disclosure — the panel no longer says
 * that a figure can trail reality by minutes. The date below still carries
 * the reset rule, which is the half the frame keeps; the lag is the half
 * that now goes unsaid.
 */
function resetCaption(resetsAt?: string | null): string | null {
  if (!resetsAt) return null;
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return null;
  // Day and month, no year — "Resets 1 September", the frame's "Resets May
  // 1" in the day-first order every other date on this page uses. The year
  // is never in doubt: the next reset is at most a month away.
  return `Resets ${at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })}`;
}

/**
 * What the usage card says about `usage`: no plan, an unlimited plan, a period the backend does
 * not compute, nothing recorded yet, or the meter with its lag line and, at the ceiling, the
 * quota-reached notice.
 */
export function UsageFigures({ usage }: { usage: PortalUsage }) {
  return (usage.plan === null ? (
    // Task 0311: the key is on no usage plan for this API's stage —
    // the "issued but dead" state the gateway answers `403` to. Stated,
    // never rendered as zeros or as "nothing recorded yet".
    <p data-testid="usage-no-plan">
      No usage plan, so there is no quota to count against.
    </p>
  ) : usage.plan && usage.plan.quota_limit === null ? (
    // Task 0311: a plan without a quota. Nothing is counted against
    // it, so there is no meter to draw — "Unlimited" is the figure.
    <p data-testid="usage-unlimited">
      <strong>Unlimited</strong> — your plan has no quota.
    </p>
  ) : usage.limit !== null && usage.resets_at === null ? (
    // Task 0311: a quota whose period the backend does not compute
    // (`WEEK`, or anything newer). The quota is stated; the counters
    // are not, because the window they need would be a guess.
    <>
      <Figure
        label="Quota"
        value={usage.limit.toLocaleString('en-US')}
        unit="requests"
        testId="usage-period-quota"
      />
      <p data-testid="usage-unsupported-period">
        Quota per{' '}
        {(usage.plan?.quota_period ?? 'period').toLowerCase()}; usage
        for this period is not shown.
      </p>
    </>
  ) : usage.used === null ? (
    <>
      {/* AWS has no rows for the key yet. Not zeros: inventing
          `remaining` and `limit` would be guessing, and the honest state
          is "nothing recorded", which for a fresh key is expected. */}
      <p>
        AWS has not recorded any usage for your key this period yet —
        figures appear with a delay after your first requests.
      </p>
    </>
  ) : (
    <>
      {/* The bar is task 0193's; the figures under it are task 0188's and
          are untouched — same labels, same `data-testid`s, same raw
          values. The meter adds the one thing three separate numbers do
          not give: the ratio, at a glance. The design puts it on the
          landing page's dashboard preview, and this is the same
          component, so the preview cannot promise a bar the real screen
          does not draw. */}
      {/* NO `resetLabel` here, unlike the landing page's preview. Task
          0188's `limits()` below already states the reset rule and the
          next date, and states it more precisely than a meter caption
          can ("the 1st of each month, 00:00 UTC" — our rule, not an AWS
          guarantee). Repeating the date two lines apart is the panel
          saying the same thing twice and inviting the two to drift. */}
      {/* Task 0188's three figures, in the design's arrangement. The
          numbers, their `data-testid`s and the raw values its tests read
          are unchanged — what went is the "Used: / Remaining: / Monthly
          limit:" labelling around them, which 0188 wrote when this panel
          was three unstyled paragraphs and which its own brief asked for
          "as numbers, not prose". Of its two STATEMENTS, the reset rule
          survives as the caption under the bar, and the lag line is the
          paragraph below the meter. */}
      <UsageMeter
        headline
        used={usage.used}
        limit={usage.limit}
        remaining={usage.remaining}
        resetLabel={resetCaption(usage.resets_at)}
      />
      {/* ⚠️ Task 0188's lag line, **back since 2026-08-27**. It was cut
          on 2026-08-25 with the reset-rule sentence and the Refresh
          button ("tutaj będą wykresy" — task 0232's chart takes the
          space), and PR #249's review sent it back: 0188 decided this
          wording once and says this slice "restyles it but does not
          re-decide it", `as_of` was still served and no longer read,
          and a developer who has just made calls and sees an unchanged
          number had nothing on screen explaining why. Rendered small,
          under the meter — the restyle — with 0188's sentence verbatim.
          `toUTCString` spells the zone "GMT"; the decided wording says
          UTC, so the suffix is corrected rather than the line frozen. */}
      <Typography
        component="p"
        variant="caption"
        data-testid="usage-as-of"
        sx={{ color: color.text.tertiary, m: 0 }}
      >
        Last updated{' '}
        {new Date(usage.as_of).toUTCString().replace(/GMT$/, 'UTC')}{' '}
        — AWS reports usage with a delay, so requests made in the last few
        minutes may not be counted yet.
      </Typography>
      {/* Only at the ceiling, and `>=` rather than `===`: AWS can count
          a burst PAST the quota (the gateway refuses on its own clock,
          not on ours), and a card that goes quiet again at 100,001 would
          be dropping the notice exactly when it is most true. */}
      {usage.limit !== null &&
        usage.limit > 0 &&
        usage.used >= usage.limit &&
        usage.resets_at !== null && (
          <QuotaReachedNotice
            resetsAt={usage.resets_at}
            period={usage.plan?.quota_period}
          />
        )}
    </>
  ));
}
