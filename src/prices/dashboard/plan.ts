/**
 * The key's usage plan as the dashboard states it (task 0311) — moved from `app/app.tsx`
 * unchanged, for the Prices portal's dashboard and the hub's Prices tab alike.
 */

import type { PortalPlan, PortalPlanTier, PortalUsage } from '../api/portal';

/**
 * What the dashboard knows about the key's usage plan (task 0311).
 *
 * - `loading` — `/usage` has not answered yet;
 * - `failed` — it answered with an error;
 * - `unknown` — it answered, but named no plan: `no_key` while the key card
 *   holds one (the backend's short cache lagging an issue), or a backend older
 *   than task 0311 that sends no `plan` at all;
 * - `known` — the plan, or `null` for a key on no plan for this API's stage.
 *
 * Only `known` puts figures on the page. The other three state no rate and
 * no tier: `/config`'s figure is the FREE plan's, and a paid key reading it as
 * its own is exactly the contradiction task 0311 exists to remove (review
 * CR-02/WR-01). `/config` stays the source for the no-key state and the
 * landing page only.
 */
export type PlanView =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'unknown' }
  | { state: 'known'; plan: PortalPlan | null };

/** `/usage`'s answer as a `PlanView` — `null` is its `no_key`. */
export function planViewOf(usage: PortalUsage | null | undefined): PlanView {
  if (!usage || usage.plan === undefined) return { state: 'unknown' };
  return { state: 'known', plan: usage.plan };
}

/**
 * A quota named by its period (task 0311's review, WR-02): the five CDK plans
 * all count per `MONTH`, but a hand-made Custom plan can count per `DAY` or
 * `WEEK`, and "Monthly quota" over a daily figure is a false statement. A
 * period this page has no word for is just "Quota"; no period known yet reads
 * as the frame's "Monthly quota", which is every CDK plan's.
 */
export function quotaLabel(period: string | null | undefined): string {
  switch (period) {
    case undefined:
    case 'MONTH':
      return 'Monthly quota';
    case 'WEEK':
      return 'Weekly quota';
    case 'DAY':
      return 'Daily quota';
    default:
      return 'Quota';
  }
}

/** The usage card's title, by the same rule as `quotaLabel`. */
export function usageTitle(period: string | null | undefined): string {
  switch (period) {
    case 'WEEK':
      return 'Weekly Usage';
    case 'DAY':
      return 'Daily Usage';
    default:
      return 'Monthly Usage';
  }
}

/**
 * A rate as the cards print it (task 0311's review, IN-03). AWS's
 * `rateLimit` is a double, so a Custom plan at 0.1 req/s is 6.000000000000001
 * per minute in floating point. At most two decimals, and no grouping — the
 * cards have always printed `1500`, not `1,500`.
 */
export function formatRate(value: number): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

/** The pill label per tier (task 0311, decision 5). */
const PLAN_LABEL: Record<PortalPlanTier, string> = {
  free: 'Free',
  basic: 'Basic',
  analyst: 'Analyst',
  lite: 'Lite',
  pro: 'Pro',
  custom: 'Custom',
};

/**
 * The contact line's copy per tier (task 0311, decision 6): the lead-in, then
 * the linked sentence.
 */
const CONTACT_COPY: Record<PortalPlanTier, readonly [string, string]> = {
  free: ['Need higher limits?', 'Contact us about a paid plan.'],
  basic: ['Need more?', 'Contact us to change your plan.'],
  analyst: ['Need more?', 'Contact us to change your plan.'],
  lite: ['Need more?', 'Contact us to change your plan.'],
  pro: ['Need custom limits?', 'Contact us.'],
  custom: ['Need custom limits?', 'Contact us.'],
};

/**
 * The pill and the contact copy for a tier — a tier this bundle does not know
 * (a newer backend: the two deploy separately) is `Custom`, never a lookup
 * that throws and unmounts the dashboard (task 0311's review, IN-04).
 */
export function planLabel(tier: string): string {
  return PLAN_LABEL[tier as PortalPlanTier] ?? PLAN_LABEL.custom;
}
export function contactCopy(tier: string): readonly [string, string] {
  return CONTACT_COPY[tier as PortalPlanTier] ?? CONTACT_COPY.custom;
}

/**
 * The no-plan state's own contact line (task 0311's review, IN-05). A key on
 * no plan is broken, not a customer asking for bigger limits, so it gets none
 * of decision 6's tier copy. What fixes it is a sign-in: the issue flow finds
 * the key on no plan and attaches it (Step 4 of `attempt()`); "contact us" is
 * for when that does not.
 */
export const NO_PLAN_CONTACT: readonly [string, string] = [
  'Signing out and in again puts it back on a plan. If that does not fix it,',
  'contact us.',
];
