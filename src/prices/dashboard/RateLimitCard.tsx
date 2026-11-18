/**
 * The Rate Limit card — moved from `app/app.tsx` unchanged, for the Prices portal's dashboard
 * and the hub's Prices tab alike.
 */

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { DashboardCard } from '../landing/DashboardPanel';
import { visuallyHidden } from '../landing/LoginSection';
import { RUMBLEFISH_CONTACT } from '../landing/links';
import { cardBorder } from '../landing/primitives';
import { color, font } from '../theme/tokens';
import { Figure, UNDERLINED } from './parts';
import {
  NO_PLAN_CONTACT,
  contactCopy,
  formatRate,
  planLabel,
  type PlanView,
} from './plan';

/**
 * The Rate Limit card — the key's plan, its two figures, and what the gateway
 * does when you cross them.
 *
 * **The figures are the key's OWN plan's** since task 0311: `/api/usage`
 * reports the plan the key is on (`plan`), and the per-second figure is its
 * `rate_limit_per_second`; the per-minute one is that times sixty, computed
 * rather than written down. The plan's name rides beside "Active" as a second
 * pill (`Free` … `Pro`, `Custom` for any other plan on our stage), and the
 * contact line under the figures links to `RUMBLEFISH_CONTACT` with copy for
 * the tier — contacting us is the only way to change plan, so it is shown on
 * every tier.
 *
 * The other states:
 *
 * - **No plan** (`plan: null`): the key is on no usage plan for this API, so
 *   the gateway answers it `403`. No pill — "Active" would be false — the
 *   state is said in words, and the contact line says what fixes it.
 * - **Unlimited** (`rate_limit_per_second: null`): both figures read
 *   "Unlimited", never a zero.
 * - **Plan not known** (`/usage` in flight, failed, or naming no plan): no
 *   figure, no pill, no tier's contact copy — only what is true of every key
 *   (the gateway's `429`/`403`). Before task 0311's review this state showed
 *   `/config`'s free figure and the free plan's pitch, which a Pro customer
 *   read, on every load, as their own limit and an offer of the plan they
 *   already pay for (review WR-01).
 *
 * **The card always renders**, which is a change from the build that dropped
 * it whenever `/config` carried no limit (Adam, 2026-08-25: "brakuje całego
 * jednego kafelka"). A missing panel is a worse answer than a stated one —
 * and since task 0311 its figures come from the key's plan, so `/config`
 * missing a limit changes nothing here at all.
 */
export function RateLimitCard({
  keyAbsent = false,
  plan,
}: {
  /**
   * The account has no key — the frame empties this card too. See the
   * dashboard's `keyAbsent`.
   *
   * ⚠️ Emptying it here is the frame's call and it is defensible — a limit
   * stated for a credential that does not exist is a number with nothing to
   * apply to, and the frame wants nothing competing with the one button on
   * the card above. **The green "Active" pill goes with it**, and that part is
   * not merely defensible but required: "Active" is a claim about a key, and
   * there is no key to make it about.
   */
  keyAbsent?: boolean;
  /** The key's plan, from `/api/usage` (task 0311) — see `PlanView`. */
  plan: PlanView;
}) {
  if (keyAbsent) return <DashboardCard title="Rate Limit" />;

  if (plan.state !== 'known') {
    return (
      <DashboardCard title="Rate Limit">
        <p data-testid="rate-limit-pending">
          {plan.state === 'loading'
            ? 'Loading your plan…'
            : plan.state === 'failed'
              ? 'Could not load your plan, so its limits are not shown.'
              : "Your plan's limits appear here once your usage has loaded."}
        </p>
        <GatewayResponses />
      </DashboardCard>
    );
  }

  if (plan.plan === null) {
    return (
      <DashboardCard title="Rate Limit">
        <p data-testid="rate-limit-no-plan">
          This key is not on a usage plan for this API, so the API answers 403
          to it.
        </p>
        <PlanContact copy={NO_PLAN_CONTACT} />
      </DashboardCard>
    );
  }

  const { tier } = plan.plan;
  // `null` is a plan without a throttle: unlimited, stated as such.
  const perSecond = plan.plan.rate_limit_per_second;

  return (
    <DashboardCard
      title="Rate Limit"
      status={[
        { label: 'Active', tone: 'ok' },
        { label: planLabel(tier), tone: 'muted' },
      ]}
    >
      <Stack direction="row" spacing={4}>
        <Figure
          label="Per-second limit"
          value={perSecond === null ? 'Unlimited' : formatRate(perSecond)}
          unit={perSecond === null ? undefined : 'req/s'}
          testId="rate-limit"
        />
        <Figure
          label="Per-minute limit"
          value={perSecond === null ? 'Unlimited' : formatRate(perSecond * 60)}
          unit={perSecond === null ? undefined : 'req/min'}
        />
      </Stack>
      {/* Task 0188's sentence, kept verbatim and read only by assistive
          technology. The design abbreviates the figure to "1 req/s", which is
          right for the eye and wrong for a screen reader — "req" is not a word.
          Expanding an abbreviation is what this technique is for, and it lets
          0188's wording survive a change that was purely visual. */}
      <Box component="p" sx={visuallyHidden}>
        {perSecond === null ? (
          <>Rate limit: unlimited.</>
        ) : (
          <>
            Rate limit: {formatRate(perSecond)} request
            {perSecond === 1 ? '' : 's'} per second.
          </>
        )}
      </Box>
      <GatewayResponses />
      <PlanContact copy={contactCopy(tier)} />
    </DashboardCard>
  );
}

/**
 * The Rate Limit card's contact line (task 0311): a link to
 * `RUMBLEFISH_CONTACT`, underlined like the OAuth card's "contact support",
 * worded for the tier. It replaced a plain-text "Contact us for commercial
 * plans." that had no destination to point at.
 */
function PlanContact({ copy }: { copy: readonly [string, string] }) {
  const [lead, link] = copy;
  return (
    <Typography
      variant="body2"
      data-testid="rate-limit-contact"
      sx={{ color: color.text.secondary }}
    >
      {lead}{' '}
      <Box component="a" href={RUMBLEFISH_CONTACT} sx={UNDERLINED}>
        {link}
      </Box>
    </Typography>
  );
}

/** The HTTP codes every key meets, whatever its plan. */
function GatewayResponses() {
  return (
    <Stack spacing={1} sx={{ pt: 1, borderTop: cardBorder }}>
      <ResponseRow label="Response on throttle" code="HTTP 429" />
      <ResponseRow label="Response on missing key" code="HTTP 403" />
    </Stack>
  );
}

function ResponseRow({ label, code }: { label: string; code: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      {/* Tertiary, measured #a3a3a3 — the label names the status beside it and
          the status is the part with the colour. */}
      <Typography variant="body2" sx={{ color: color.text.tertiary }}>
        {label}
      </Typography>
      <Typography
        component="code"
        sx={{
          fontFamily: font.mono,
          fontSize: '0.875rem',
          fontWeight: 700,
          color: color.text.error,
        }}
      >
        {code}
      </Typography>
    </Stack>
  );
}
