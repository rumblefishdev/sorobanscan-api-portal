import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { useState } from "react";
import { Link } from "react-router";

import { describeUtcDay } from "../../prices/dashboard/dates";
import { GlyphBadge } from "../../prices/dashboard/parts";
import {
  DashboardCard,
  KeyField,
  MetaField,
  MetaRow,
  NoticeStrip,
  type Pill,
} from "../../prices/landing/DashboardPanel";
import { DiscordIcon } from "../../prices/landing/DiscordIcon";
import { color } from "../../prices/theme/tokens";
import { GetKeyForm } from "../GetKeyForm";
import type { GetKeyControl } from "../useIssueWindow";
import { useRevealedKey } from "../useRevealedKey";
import { IssueBanner, type IssueOutcome } from "../prices/IssueOutcome";
import type { Account } from "../prices/KeyCard";
import {
  describeFailure,
  HubError,
  isSignedOut,
  isUnavailable,
  keyIsGone,
  revealKey,
  revokeKey,
  UNAVAILABLE,
  type X402Account,
  type X402Key,
} from "./api";
import { X402ReplaceKey } from "./X402ReplaceKey";

/** What the tab knows of the account: asking, x402's answer, or why there is none. */
export type AccountView =
  | { state: "loading" }
  | { state: "ok"; account: X402Account }
  | { state: "failed"; error: unknown };

/** The key's value on screen until it is shown: a fixed run of dots, no part of the key. */
const MASK = "••••••••••••••••••••••••••••••••";

/** Said where a key can't be shown, from the account's `showable` or a `409 key_not_viewable`. */
const NOT_VIEWABLE =
  "This key can't be shown again. Regenerate ends it; a new key can be issued from the next calendar month.";

/** A date as the Prices tab words it, or the month's start when the hub gave none. */
const dayOr = (value: string | null | undefined) =>
  describeUtcDay(value) ?? "the start of next month";

/**
 * The x402 tab's "API Key" card: the Prices tab's (`../prices/KeyCard.tsx`), from the same parts,
 * without its usage, plan and rate limit (the month's payments are `X402UsageCard`'s); its rule is
 * the calendar month (UTC). Copied rather than shared, since the parts that differ run through the
 * whole of it.
 *
 * - **No key**: "Get API Key", a form `POST` to the hub with `product=x402`, its round trip in a
 *   second window (`../GetKeyForm.tsx`).
 * - **Active**: the key masked, shown and copied through `key/reveal` on a press; "Regenerate"
 *   revokes through `key/revoke`, behind a typed phrase, and issues nothing.
 * - **Revoked**: when, and when a new key can be had; "Get API Key" once it can.
 * - The outcome of "Get API Key", from its window or from `?issue=`, above all of it.
 */
export function X402KeyCard({
  view,
  outcome,
  account,
  getKey,
  showable,
  onReload,
  onRevoked,
}: {
  view: AccountView;
  outcome: IssueOutcome | null;
  account: Account;
  /** "Get API Key"'s second window (`useIssueWindow`). */
  getKey: GetKeyControl;
  /** Whether the account says the key can be shown. */
  showable: boolean;
  /** Reads the account again. */
  onReload: () => void;
  onRevoked: (revoked: { revoked_at?: string; next_eligible_at?: string }) => void;
}) {
  const key = view.state === "ok" ? view.account.key : null;
  // `?issue=issued` while the account doesn't list the key yet: it was made a moment ago.
  const settling = outcome === "issued" && key?.state === "none";
  const status: Pill | undefined =
    key?.state === "active"
      ? { label: "Active", tone: "ok" }
      : key?.state === "none" && !settling
        ? { label: "Not issued", tone: "bad" }
        : key?.state === "revoked"
          ? { label: "Revoked", tone: "bad" }
          : undefined;

  return (
    <DashboardCard title="API Key" status={status}>
      {/* Kept over an account read that failed: the key was made all the same, and without it the
          failure below reads as a failed issue. Where the account doesn't list the key yet,
          `settling` says so instead. */}
      {outcome === "issued" && (view.state !== "ok" || key?.state === "active") && (
        <p data-testid="issue-issued" role="status">
          Your API key is ready. Show or copy it below.
        </p>
      )}
      <IssueBanner
        outcome={outcome}
        username={account.username}
        nextEligibleAt={
          view.state === "loading"
            ? undefined
            : key && key.state === "revoked"
              ? (key.next_eligible_at ?? null)
              : null
        }
        period="calendar month"
        describeDate={dayOr}
      />

      {view.state === "loading" && <p>Checking for your API key…</p>}
      {view.state === "failed" && <AccountFailed error={view.error} onRetry={onReload} />}

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
          showable={showable}
          onGone={onReload}
          onRevoked={onRevoked}
        />
      )}
      {key?.state === "revoked" && <RevokedKey keyState={key} getKey={getKey} />}

      {key !== null && key.state !== "none" && (
        <MetaRow>
          {key.state === "active" && (
            <MetaField label="Key ID">
              <code>{key.key_id}</code>
            </MetaField>
          )}
          {key.state === "active" && describeUtcDay(key.created_at) && (
            <MetaField label="Issued">{describeUtcDay(key.created_at)}</MetaField>
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

      {key?.state === "active" && (
        <NoticeStrip>
          <p>
            Regenerating is limited to <strong>once per calendar month</strong> and issues nothing
            now.
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
  keyState: Extract<X402Key, { state: "none" }>;
  account: Account;
  getKey: GetKeyControl;
}) {
  return (
    <>
      <NoticeStrip tone="error">
        <p data-testid="no-key-notice">
          No API key found for your account. If you contact us, quote your Discord ID{" "}
          <code data-testid="no-key-discord-id">{account.id}</code>.
        </p>
      </NoticeStrip>
      {keyState.can_issue && <GetKeyForm product="x402" getKey={getKey} />}
    </>
  );
}

/** A revoked key: when it stopped working, and when a new one can be had. */
function RevokedKey({
  keyState,
  getKey,
}: {
  keyState: Extract<X402Key, { state: "revoked" }>;
  getKey: GetKeyControl;
}) {
  const on = describeUtcDay(keyState.revoked_at);
  return (
    <Stack spacing={2} data-testid="key-revoked">
      <p>
        Your key was revoked{on ? ` on ${on}` : ""}.{" "}
        {keyState.can_issue
          ? "A new key can be issued now."
          : `A new key can be issued from ${dayOr(keyState.next_eligible_at)}.`}
      </p>
      {keyState.can_issue && <GetKeyForm product="x402" getKey={getKey} />}
    </Stack>
  );
}

/**
 * A working key: masked, shown or copied through `key/reveal` (asked once, on the first press that
 * needs it), and Regenerate. The value lives here and nowhere else, and goes with this component.
 * A key the account says can't be shown, or that `reveal` says so of, has neither button.
 */
function ActiveKey({
  showable,
  onGone,
  onRevoked,
}: {
  showable: boolean;
  /** The key isn't there any more (revoked or removed elsewhere): the account is read again. */
  onGone: () => void;
  onRevoked: (revoked: { revoked_at?: string; next_eligible_at?: string }) => void;
}) {
  /** `reveal` said `key_not_viewable`: the key can't be shown, whatever the account said. */
  const [notViewable, setNotViewable] = useState(false);
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
  } = useRevealedKey({
    fetchKey: revealKey,
    isGone: keyIsGone,
    describeFailure,
    onGone,
    isNotViewable: (cause) => cause instanceof HubError && cause.code === "key_not_viewable",
    onNotViewable: () => setNotViewable(true),
  });
  const [replacing, setReplacing] = useState(false);

  const viewable = showable && !notViewable;

  return (
    <>
      <KeyField
        testId="api-key"
        value={revealed && value !== null ? value : MASK}
        inlineAction={
          viewable ? (
            <button type="button" data-testid="show-key" onClick={onShow} disabled={revealing}>
              {revealed ? "Hide key" : "Show key"}
            </button>
          ) : undefined
        }
        actions={
          <>
            {viewable && (
              <button type="button" data-variant="primary" onClick={onCopy}>
                <GlyphBadge icon={ContentCopyRoundedIcon} tone="onPrimary" />
                Copy key
              </button>
            )}
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
        }
      />
      {!viewable && <p data-testid="key-not-viewable">{NOT_VIEWABLE}</p>}
      {/* `status`, so the copy is heard as well as seen: the button's label doesn't change. */}
      {copied && <p role="status">Copied.</p>}
      {/* `alert`: a press that didn't do what it said. */}
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
      {replacing && (
        <X402ReplaceKey
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
  // An ended session isn't helped by asking again: the sign-in page is the way back.
  if (isSignedOut(error)) {
    return (
      <>
        <p data-testid="account-failed" role="alert">
          Your session has ended. Sign in again to see your x402 API key.
        </p>
        <Link to="/login">Sign in again</Link>
      </>
    );
  }
  return (
    <>
      <p data-testid="account-failed" role="alert">
        {isUnavailable(error)
          ? UNAVAILABLE
          : `Could not load your x402 API key: ${describeFailure(error)}.`}
      </p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </>
  );
}
