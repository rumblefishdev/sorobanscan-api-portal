import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { useState } from "react";

import type { PortalKeyRevoked, PortalPlan } from "../../prices/api/portal";
import {
  describeNextEligible,
  describeNextPeriodStart,
  describeUtcDay,
} from "../../prices/dashboard/dates";
import { DeactivationSentence, GlyphBadge } from "../../prices/dashboard/parts";
import { formatRate, quotaLabel } from "../../prices/dashboard/plan";
import { ReplaceKey } from "../../prices/dashboard/ReplaceKey";
import {
  DashboardCard,
  KeyField,
  MetaField,
  MetaRow,
  NoticeStrip,
  type Pill,
} from "../../prices/landing/DashboardPanel";
import { DiscordIcon } from "../../prices/landing/DiscordIcon";
import { QUICKSTART } from "../../prices/landing/links";
import { ArrowBadge } from "../../prices/landing/primitives";
import { color } from "../../prices/theme/tokens";
import { GetKeyForm } from "../GetKeyForm";
import { SIGN_IN_URL } from "../session";
import type { GetKeyControl } from "../useIssueWindow";
import { useRevealedKey } from "../useRevealedKey";
import {
  HubError,
  describeFailure,
  keyIsGone,
  revealKey,
  revokeKey,
  type PricesAccount,
  type PricesKey,
} from "./api";
import { IssueBanner, type IssueOutcome } from "./IssueOutcome";

/** What the tab knows of the account: asking, Prices' answer, or why there is none. */
export type AccountView =
  | { state: "loading" }
  | { state: "ok"; account: PricesAccount }
  | { state: "failed"; error: unknown };

/** The signed-in account, as the session names it. */
export interface Account {
  id: string;
  username: string;
}

/** The key's value on screen until it is shown: a fixed run of dots, no part of the key. */
const MASK = "••••••••••••••••••••••••••••••••";

/**
 * The Prices tab's "API Key" card: the Prices portal's (`ApiKey` in `src/prices/app/app.tsx`),
 * drawn from the same parts, its states fed by the hub's `account` instead of `/api/key`.
 *
 * - **No key**: "Get API Key", a form `POST` to the hub (akot, 2026-11-18: in the tab, where
 *   Prices issued at sign-in), its round trip in a second window (`../GetKeyForm.tsx`).
 * - **Active**: the key masked, shown and copied through the hub's `key/reveal`, asked for only
 *   on Show key or Copy key; "Regenerate" opens Prices' dialog, which revokes through the hub's
 *   `key/revoke`.
 * - **Revoked**: when it was, and when a new key can be had; "Get API Key" once it can.
 * - The outcome of "Get API Key", from its window or from `?issue=`, above all of it.
 */
export function KeyCard({
  view,
  outcome,
  account,
  getKey,
  partial,
  onReload,
  onRevoked,
}: {
  view: AccountView;
  outcome: IssueOutcome | null;
  account: Account;
  /** "Get API Key"'s second window (`useIssueWindow`). */
  getKey: GetKeyControl;
  /** The revoke on this page disabled some of the account's keys but not every one. */
  partial: boolean;
  /** Reads the account again. */
  onReload: () => void;
  onRevoked: (revoked: PortalKeyRevoked) => void;
}) {
  const key = view.state === "ok" ? view.account.key : null;
  const usage = view.state === "ok" ? view.account.usage : null;
  // `?issue=issued` while the account doesn't list the key yet: it was made a moment ago.
  const settling = outcome === "issued" && key?.state === "none";
  // The first-login card Prices draws for the page load that follows an issue.
  const justIssued = outcome === "issued" && key?.state === "active";
  const status: Pill | undefined =
    key?.state === "active"
      ? // Prices' word for every key that works (Adam, 2026-08-25).
        { label: "Just issued", tone: "ok" }
      : key?.state === "none" && !settling
        ? { label: "Not issued", tone: "bad" }
        : key?.state === "revoked"
          ? { label: "Revoked", tone: "bad" }
          : undefined;

  return (
    <DashboardCard title={justIssued ? "Your API Key is ready" : "API Key"} status={status}>
      {/* Prices' line for the key the round trip made. Kept over an account read that failed:
          the key was made all the same, and without it the failure below reads as a failed
          issue. Where the account doesn't list the key yet, `settling` says so instead. */}
      {outcome === "issued" && (view.state !== "ok" || key?.state === "active") && (
        <p data-testid="issue-issued" role="status">
          Welcome! Your API key has been generated. Copy it below and make your first request —
          the Quick Start guide has everything you need.
        </p>
      )}
      <IssueBanner
        outcome={outcome}
        username={account.username}
        nextEligibleAt={
          view.state === "loading"
            ? undefined
            : key && key.state !== "active"
              ? (key.next_eligible_at ?? null)
              : null
        }
      />

      {view.state === "loading" && <p>Checking for your API key…</p>}
      {view.state === "failed" && <AccountFailed error={view.error} onRetry={onReload} />}

      {/* Issued a moment ago, not listed yet: a wait, and no second "Get API Key". */}
      {settling && (
        <p data-testid="issue-settling" role="status">
          Your key was created, and is taking a moment to appear.{" "}
          <button type="button" onClick={onReload}>
            Check again
          </button>
        </p>
      )}

      {key?.state === "none" && !settling && (
        <NoKey keyState={key} account={account} getKey={getKey} />
      )}
      {key?.state === "active" && (
        <ActiveKey
          // A new key is a new card: nothing shown or copied of the old one carries over.
          key={key.key_id}
          justIssued={justIssued}
          plan={usage?.plan}
          quota={usage?.limit ?? null}
          onGone={onReload}
          onRevoked={onRevoked}
        />
      )}
      {key?.state === "revoked" && (
        <RevokedKey keyState={key} partial={partial} getKey={getKey} />
      )}

      {key !== null && key.state !== "none" && !justIssued && (
        <MetaRow>
          {key.state === "active" && (
            <MetaField label="Key ID">
              <code>{key.key_id}</code>
            </MetaField>
          )}
          {key.state === "active" && describeUtcDay(key.created_at) && (
            <MetaField label="Issued">{describeUtcDay(key.created_at)}</MetaField>
          )}
          {key.state === "active" && describeUtcDay(key.last_updated_at) && (
            <MetaField label="Last updated">{describeUtcDay(key.last_updated_at)}</MetaField>
          )}
          <MetaField label="Discord account">
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                aria-hidden
                sx={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: "6px",
                  display: "grid",
                  placeItems: "center",
                  backgroundColor: "#5865f2",
                  color: color.white,
                }}
              >
                <DiscordIcon sx={{ fontSize: 14 }} />
              </Box>
              {/* The id, which is the account (the handle can change), one hover away. */}
              <Box component="span" title={account.id}>
                {account.username}
              </Box>
            </Stack>
          </MetaField>
        </MetaRow>
      )}

      {/* Prices' strip under a working key: the rule Regenerate is under, and its date, the
          plan's own reset when its quota counts per month (task 0311's review, WR-02). */}
      {key?.state === "active" && !justIssued && (
        <NoticeStrip>
          <p>
            Regenerating is limited to <strong>once per quota period</strong> and issues nothing
            now. A new key can be issued from:{" "}
            <strong>
              {(usage?.plan?.quota_period === "MONTH" ? describeUtcDay(usage.resets_at) : null) ??
                describeNextPeriodStart()}
            </strong>
          </p>
        </NoticeStrip>
      )}
    </DashboardCard>
  );
}

/** The `Dashboard - no key` frame: the red strip, then the one action. */
function NoKey({
  keyState,
  account,
  getKey,
}: {
  keyState: Extract<PricesKey, { state: "none" }>;
  account: Account;
  getKey: GetKeyControl;
}) {
  return (
    <>
      <NoticeStrip tone="error">
        {/* Prices' strip, less "This can happen if key issuance failed during sign-in": here no
            key is issued at sign-in. */}
        <p data-testid="no-key-notice">
          No API key found for your account. If you contact us, quote your Discord ID{" "}
          <code data-testid="no-key-discord-id">{account.id}</code>.
        </p>
      </NoticeStrip>
      {keyState.can_issue ? (
        <GetKeyForm product="prices" getKey={getKey} />
      ) : (
        <CapNotice nextEligibleAt={keyState.next_eligible_at} />
      )}
    </>
  );
}

/** When a key can be had again, and that there is none until then. Prices' revoked-key words. */
function CapNotice({ nextEligibleAt }: { nextEligibleAt: string | null | undefined }) {
  return (
    <NoticeStrip>
      <p data-testid="key-cap">
        You can generate a new key from <strong>{describeNextEligible(nextEligibleAt)}</strong>.
        Until then you do not have a working key.
      </p>
    </NoticeStrip>
  );
}

/** A revoked key: when it stopped working, and when a new one can be had (Prices' task 0191). */
function RevokedKey({
  keyState,
  partial,
  getKey,
}: {
  keyState: Extract<PricesKey, { state: "revoked" }>;
  partial: boolean;
  getKey: GetKeyControl;
}) {
  return (
    <Stack spacing={2} data-testid="key-revoked">
      {/* Prices' warning for a revoke that left a duplicate working. Neither sentence below is
          true of it, so neither renders. */}
      {partial && (
        <p data-testid="revoke-partial">
          <strong>One of your keys could not be deactivated.</strong> A duplicate under this name
          may still work against <code>/v1/</code>. Reload the page and press{" "}
          <strong>Regenerate</strong> again — it retries every key, and it will not cost you a
          second revocation.
        </p>
      )}
      <DeactivationSentence
        revoked={{
          revoked: true,
          next_eligible_at: keyState.next_eligible_at ?? "",
          revoked_at: keyState.revoked_at ?? undefined,
        }}
      />
      {partial ? null : keyState.can_issue ? (
        <>
          <p data-testid="key-can-issue">A new key can be issued now.</p>
          <GetKeyForm product="prices" getKey={getKey} />
        </>
      ) : (
        <CapNotice nextEligibleAt={keyState.next_eligible_at} />
      )}
    </Stack>
  );
}

/**
 * A working key: masked, shown or copied through the hub's `key/reveal` (asked once, on the first
 * press that needs it), and Prices' Regenerate. The value lives here and nowhere else, and goes
 * with this component.
 */
function ActiveKey({
  justIssued,
  plan,
  quota,
  onGone,
  onRevoked,
}: {
  justIssued: boolean;
  /** The key's plan once Prices has named it; never `/config`'s free figure (task 0311). */
  plan: PortalPlan | null | undefined;
  quota: number | null;
  /** The key isn't there any more (revoked or removed elsewhere): the account is read again. */
  onGone: () => void;
  onRevoked: (revoked: PortalKeyRevoked) => void;
}) {
  const {
    value,
    revealed,
    revealing,
    revealFailure,
    copied,
    copyFailure,
    onShow,
    onCopy,
    hide,
  } = useRevealedKey({ fetchKey: revealKey, isGone: keyIsGone, describeFailure, onGone });
  const [replacing, setReplacing] = useState(false);

  const copyButton = (
    <button type="button" data-variant="primary" onClick={onCopy}>
      <GlyphBadge icon={ContentCopyRoundedIcon} tone="onPrimary" />
      Copy key
    </button>
  );

  return (
    <>
      <KeyField
        testId="api-key"
        value={revealed && value !== null ? value : MASK}
        inlineAction={
          <button type="button" data-testid="show-key" onClick={onShow} disabled={revealing}>
            {revealed ? "Hide key" : "Show key"}
          </button>
        }
        actions={
          justIssued ? (
            <>
              {copyButton}
              <a href={QUICKSTART} data-variant="quiet">
                View quick start
                <ArrowBadge variant="onLight" />
              </a>
            </>
          ) : (
            <>
              {copyButton}
              {!replacing && (
                <button
                  type="button"
                  onClick={() => setReplacing(true)}
                  data-testid="replace-key-open"
                >
                  <GlyphBadge icon={AutorenewRoundedIcon} tone="onDark" />
                  Regenerate
                </button>
              )}
            </>
          )
        }
      />
      {/* `status`, so the copy is heard as well as seen: the button's label doesn't change. */}
      {copied && <p role="status">Copied.</p>}
      {/* `alert`, as Prices' failed revoke is: a press that didn't do what it said. */}
      {revealFailure && (
        <p data-testid="reveal-failed" role="alert">
          Could not show your API key: {revealFailure}.
        </p>
      )}
      {copyFailure && (
        <p role="alert">
          Could not copy your API key: <code>{copyFailure}</code>
        </p>
      )}
      {/* Prices' first-login row: when, and the plan's quota and rate, once Prices named it. */}
      {justIssued && (
        <MetaRow>
          <MetaField label="Issued">Just now</MetaField>
          {plan && quota !== null && (
            <MetaField label={quotaLabel(plan.quota_period)}>
              {quota.toLocaleString("en-US")} requests
            </MetaField>
          )}
          {plan && plan.quota_limit === null && <MetaField label="Quota">Unlimited</MetaField>}
          {plan && (
            <MetaField label="Rate limit">
              {plan.rate_limit_per_second === null
                ? "Unlimited"
                : `${formatRate(plan.rate_limit_per_second)} req/s`}
            </MetaField>
          )}
        </MetaRow>
      )}
      {replacing && (
        <ReplaceKey
          revoke={revokeKey}
          describeFailure={describeFailure}
          onClose={() => setReplacing(false)}
          onRevoked={(revoked) => {
            setReplacing(false);
            hide();
            onRevoked(revoked);
          }}
        />
      )}
    </>
  );
}

/** Why the account couldn't be read, in words, and the one thing that helps. */
function AccountFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const signedOut = error instanceof HubError && error.code === "not_signed_in";
  return (
    <>
      <p data-testid="account-failed" role="alert">
        Could not load your Prices API key: {describeFailure(error)}.
      </p>
      {/* An ended session isn't helped by asking again: a sign-in is the way back. */}
      {signedOut ? (
        <a href={SIGN_IN_URL}>Sign in again</a>
      ) : (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </>
  );
}
