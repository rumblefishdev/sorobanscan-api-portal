import Box from "@mui/material/Box";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PortalKeyRevoked } from "../../prices/api/portal";
import { stillWaiting } from "../../prices/dashboard/dates";
import { PortalStatusChrome } from "../../prices/dashboard/parts";
import { planViewOf, usageTitle, type PlanView } from "../../prices/dashboard/plan";
import { RateLimitCard } from "../../prices/dashboard/RateLimitCard";
import { UsageFigures } from "../../prices/dashboard/UsageFigures";
import { DashboardCard } from "../../prices/landing/DashboardPanel";
import { fetchAccount, type PricesAccount } from "./api";
import { useIssueOutcome } from "./IssueOutcome";
import { KeyCard, type Account, type AccountView } from "./KeyCard";

/**
 * The dashboard's Prices tab: the Prices portal's dashboard as it is today (akot, 2026-11-18, from
 * a screenshot of it) — the API Key card, Monthly Usage and Rate Limit — built from its own parts
 * (`src/prices/landing/DashboardPanel.tsx`, `src/prices/dashboard/`) and inside its own chrome,
 * so it looks and reads the same. What feeds it is the hub's backend: one `account` call for the
 * key and its use, where the portal made three, and `key/reveal` and `key/revoke` on a press.
 */
export function PricesTab({ account }: { account: Account }) {
  const outcome = useIssueOutcome();
  const [view, setView] = useState<AccountView>({ state: "loading" });
  /** The revoke on this page left a duplicate key working (Prices' partial revocation). */
  const [partial, setPartial] = useState(false);

  // One read at a time: a newer one supersedes an older answer, and leaving the tab drops it.
  const cancelInFlight = useRef<(() => void) | null>(null);
  const load = useCallback(() => {
    cancelInFlight.current?.();
    let live = true;
    cancelInFlight.current = () => {
      live = false;
    };
    fetchAccount().then(
      (read) => {
        if (live) setView({ state: "ok", account: read });
      },
      (error: unknown) => {
        if (live) setView({ state: "failed", error });
      },
    );
  }, []);
  useEffect(() => {
    load();
    return () => cancelInFlight.current?.();
  }, [load]);

  // Asked again from a press, so it shows: the cards go back to their loading words.
  const reload = useCallback(() => {
    setView({ state: "loading" });
    setPartial(false);
    load();
  }, [load]);

  // The revoke's own answer is the account's key from now: the account read straight after it
  // could still list the key Prices has just switched off. The usage stays the account's.
  const onRevoked = (revoked: PortalKeyRevoked) => {
    setPartial(revoked.partial === true);
    setView((was) =>
      was.state !== "ok"
        ? was
        : {
            state: "ok",
            account: {
              ...was.account,
              key: {
                state: "revoked",
                revoked_at: revoked.revoked_at ?? null,
                next_eligible_at: revoked.next_eligible_at,
                can_issue: !stillWaiting(revoked.next_eligible_at),
              },
            },
          },
    );
  };

  const key = view.state === "ok" ? view.account.key : null;
  // A key Prices made a moment ago and doesn't list yet is a key for the two tiles below.
  const settling = outcome === "issued" && key?.state === "none";
  const plan: PlanView =
    view.state === "loading"
      ? { state: "loading" }
      : view.state === "failed" || usageReadFailed(view.account)
        ? { state: "failed" }
        : planViewOf(view.account.usage);

  return (
    <PortalStatusChrome>
      <KeyCard
        view={view}
        outcome={outcome}
        account={account}
        partial={partial}
        onReload={reload}
        onRevoked={onRevoked}
      />
      {/* Prices' two columns, 7 : 5, one at 375 px; the shorter card keeps its own height. */}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          alignItems: "start",
          gridTemplateColumns: { xs: "1fr", md: "7fr 5fr" },
        }}
      >
        <UsageCard view={view} settling={settling} />
        {/* A limit is a claim about a key: none while there is no key, or only a revoked one. */}
        <RateLimitCard
          keyAbsent={(key?.state === "none" && !settling) || key?.state === "revoked"}
          plan={plan}
        />
      </Box>
    </PortalStatusChrome>
  );
}

/**
 * Whether Prices couldn't read the use of a key that works. The hub's contract says so with
 * `usage: null` beside `active`: a key with nothing counted yet still comes with Prices' usage, its
 * `used` null, so a missing one is a read that failed, not a new key.
 */
const usageReadFailed = (account: PricesAccount) =>
  account.key.state === "active" && account.usage === null;

/** Monthly Usage: the portal's card (`Usage` in `src/prices/app/app.tsx`), from the account. */
function UsageCard({ view, settling }: { view: AccountView; settling: boolean }) {
  if (view.state === "loading") {
    return (
      <DashboardCard title="Monthly Usage">
        <p>Loading your usage…</p>
      </DashboardCard>
    );
  }
  // Prices' "Could not load your usage", without its reason: when the account failed the key card
  // above says why, and when only the usage did the hub's contract gives none.
  if (view.state === "failed" || usageReadFailed(view.account)) {
    return (
      <DashboardCard title="Monthly Usage">
        <p data-testid="usage-failed">Could not load your usage.</p>
      </DashboardCard>
    );
  }
  const { key, usage } = view.account;
  // The `Dashboard - no key` frame: an empty tile, so nothing competes with "Get API Key".
  if (key.state === "none" && !settling) return <DashboardCard title="Monthly Usage" />;
  if (usage) {
    return (
      <DashboardCard title={usageTitle(usage.plan?.quota_period)}>
        <UsageFigures usage={usage} />
      </DashboardCard>
    );
  }
  return (
    <DashboardCard title="Monthly Usage">
      {key.state === "revoked" ? (
        <p data-testid="usage-after-revoke">
          Your key was deactivated; there is no usage to show for it.
        </p>
      ) : (
        // `settling`: the key was issued a moment ago and Prices doesn't list it yet.
        <p>Your key is new — usage figures appear here with a delay after your first requests.</p>
      )}
    </DashboardCard>
  );
}
