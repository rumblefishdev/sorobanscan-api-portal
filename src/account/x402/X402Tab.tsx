import Box from "@mui/material/Box";
import { useCallback, useEffect, useRef, useState } from "react";

import { stillWaiting } from "../../prices/dashboard/dates";
import { PortalStatusChrome } from "../../prices/dashboard/parts";
import { DashboardCard } from "../../prices/landing/DashboardPanel";
import { useIssueOutcome } from "../prices/IssueOutcome";
import type { Account } from "../prices/KeyCard";
import { useIssueWindow } from "../useIssueWindow";
import { fetchAccount } from "./api";
import { X402KeyCard, type AccountView } from "./X402KeyCard";
import { X402UsageCard } from "./X402UsageCard";

/**
 * The account's month on Mainnet, once the account is read with a key and x402 sends a usage for
 * it (`null` when x402 couldn't read it), or `undefined` for the Mainnet tile.
 */
const usageOf = (view: AccountView) =>
  view.state === "ok" && view.account.key.state !== "none" ? view.account.usage : undefined;

/**
 * The dashboard's x402 tab: the API Key card, from the Prices tab's parts without its rate limit;
 * on Mainnet, the account's payments this month; and on testnet, a tile that says no key is
 * needed. The Mainnet tile says what is so there, as it did before the account quota, wherever
 * there is no month to show: while the account is read, when its read failed (the key card says
 * so), for an account without a key, and from an x402 that sends no usage. What feeds it is the
 * hub's backend: one `account` call for the key and its use, and `key/reveal` and `key/revoke` on
 * a press.
 */
export function X402Tab({ account }: { account: Account }) {
  const fromAddress = useIssueOutcome();
  const [view, setView] = useState<AccountView>({ state: "loading" });

  // One read at a time: a newer one supersedes an older answer, and leaving the tab drops it.
  const cancelInFlight = useRef<(() => void) | null>(null);
  const load = useCallback(() => {
    cancelInFlight.current?.();
    const reading = new AbortController();
    cancelInFlight.current = () => reading.abort();
    fetchAccount(reading.signal).then(
      (read) => {
        if (!reading.signal.aborted) setView({ state: "ok", account: read });
      },
      (error: unknown) => {
        if (!reading.signal.aborted) setView({ state: "failed", error });
      },
    );
  }, []);
  useEffect(() => {
    load();
    return () => cancelInFlight.current?.();
  }, [load]);

  // Asked again from a press, so it shows: the card goes back to its loading words.
  const reload = useCallback(() => {
    setView({ state: "loading" });
    load();
  }, [load]);

  // "Get API Key" in a second window: when it is done the account is read again, and its outcome
  // has the last word over the one an earlier round trip left in the address.
  const getKey = useIssueWindow(reload);
  const outcome = getKey.attempted ? getKey.outcome : fromAddress;

  // The revoke's own answer is the account's key from now: the account read straight after it
  // could still list the key that was just revoked.
  const onRevoked = (revoked: { revoked_at?: string; next_eligible_at?: string }) => {
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
                next_eligible_at: revoked.next_eligible_at ?? null,
                // Without a date to wait for, the month's rule is the hub's to say on a reload.
                can_issue:
                  revoked.next_eligible_at !== undefined && !stillWaiting(revoked.next_eligible_at),
              },
            },
          },
    );
  };

  const usage = usageOf(view);

  return (
    <PortalStatusChrome>
      <X402KeyCard
        view={view}
        outcome={outcome}
        account={account}
        getKey={getKey}
        showable={view.state === "ok" && view.account.showable}
        onReload={reload}
        onRevoked={onRevoked}
      />
      {/* Each network: pubnet reads the key and counts the month's payments, testnet neither. */}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          alignItems: "start",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        }}
      >
        {usage !== undefined ? (
          <X402UsageCard usage={usage} />
        ) : (
          <DashboardCard title="Mainnet (pubnet)">
            <p>API key required on /verify and /settle</p>
          </DashboardCard>
        )}
        <DashboardCard title="Testnet">
          <p>No API key needed</p>
        </DashboardCard>
      </Box>
    </PortalStatusChrome>
  );
}
