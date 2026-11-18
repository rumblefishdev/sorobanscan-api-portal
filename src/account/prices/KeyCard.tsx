import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useEffect, useRef, useState } from "react";

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
import { theme } from "../../prices/theme/theme";
import { color, radius } from "../../prices/theme/tokens";
import { SIGN_IN_URL } from "../session";
import {
  HubError,
  ISSUE_URL,
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
 *   Prices issued at sign-in).
 * - **Active**: the key masked, shown and copied through the hub's `key/reveal`, asked for only
 *   on Show key or Copy key; "Regenerate" opens Prices' dialog, which revokes through the hub's
 *   `key/revoke`.
 * - **Revoked**: when it was, and when a new key can be had; "Get API Key" once it can.
 * - The `?issue=` outcome the visitor came back with, above all of it.
 */
export function KeyCard({
  view,
  outcome,
  account,
  partial,
  onReload,
  onRevoked,
}: {
  view: AccountView;
  outcome: IssueOutcome | null;
  account: Account;
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

      {key?.state === "none" && !settling && <NoKey keyState={key} account={account} />}
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
      {key?.state === "revoked" && <RevokedKey keyState={key} partial={partial} />}

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

/**
 * "Get API Key": a real form, not a `fetch`. The issue is a round trip through Discord, a
 * top-level navigation; the hub reads the product from an urlencoded body only, and refuses a
 * `POST` that doesn't name this page as its origin, which the browser does for a form.
 */
function GetKeyForm() {
  return (
    <form method="post" action={ISSUE_URL} data-testid="get-api-key">
      <input type="hidden" name="product" value="prices" />
      {/* Prices' full-width brand bar for the card's one action (`data-variant="cta"` there). */}
      <Button
        type="submit"
        fullWidth
        variant="contained"
        sx={{
          minHeight: 56,
          gap: 1.5,
          borderRadius: `${radius.pill}px`,
          ...theme.typography.body2,
          fontWeight: 700,
          textTransform: "none",
          backgroundColor: color.surface.primary,
          color: color.black,
          boxShadow: "none",
          "&:hover": { backgroundColor: color.primary[300], boxShadow: "none" },
        }}
      >
        <GlyphBadge icon={AddRoundedIcon} tone="onPrimary" />
        Get API Key
      </Button>
    </form>
  );
}

/** The `Dashboard - no key` frame: the red strip, then the one action. */
function NoKey({
  keyState,
  account,
}: {
  keyState: Extract<PricesKey, { state: "none" }>;
  account: Account;
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
      {keyState.can_issue ? <GetKeyForm /> : <CapNotice nextEligibleAt={keyState.next_eligible_at} />}
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
}: {
  keyState: Extract<PricesKey, { state: "revoked" }>;
  partial: boolean;
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
          <GetKeyForm />
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
  const [value, setValue] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealFailure, setRevealFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailure, setCopyFailure] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  /** The reveal under way, so a second press waits for it rather than asking again. */
  const asking = useRef<Promise<string | null> | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // "Copied." for two seconds, so a second copy shows it worked too (Prices' rule).
  useEffect(() => {
    if (!copied) return;
    const clearing = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(clearing);
  }, [copied]);

  /** The key's value, asked of the hub the first time: `null` when it can't be had. */
  const reveal = (): Promise<string | null> => {
    if (value !== null) return Promise.resolve(value);
    if (asking.current) return asking.current;
    setRevealing(true);
    setRevealFailure(null);
    const pending = revealKey()
      .then(
        (key) => {
          if (live.current) setValue(key.value);
          return key.value;
        },
        (cause: unknown) => {
          if (live.current) {
            if (keyIsGone(cause)) onGone();
            else setRevealFailure(describeFailure(cause));
          }
          return null;
        },
      )
      .finally(() => {
        asking.current = null;
        if (live.current) setRevealing(false);
      });
    asking.current = pending;
    return pending;
  };

  const onShow = () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    void reveal().then((shown) => {
      if (shown !== null && live.current) setRevealed(true);
    });
  };

  const onCopy = () => {
    // Absent on an insecure origin; said rather than thrown, as Prices does.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setCopyFailure("Copying is not available here — reveal the key and copy it by hand.");
      return;
    }
    const done = () => {
      if (!live.current) return;
      setCopied(true);
      setCopyFailure(null);
    };
    const refused = () => {
      if (live.current) setCopyFailure("Could not copy — reveal the key and copy it by hand.");
    };
    // WebKit (Safari, and every browser on iOS) lets a page write the clipboard only from within
    // the press, and the key is a round trip away until it has been shown. So the write starts
    // here: the key itself when it is held, or a `ClipboardItem` holding the promise of it, which
    // the browser waits on.
    if (value !== null) {
      clipboard.writeText(value).then(done, refused);
      return;
    }
    // One reveal for the press, whichever way it is written.
    const asked = reveal();
    if (typeof ClipboardItem === "function" && typeof clipboard.write === "function") {
      // A failed reveal says why itself (`reveal-failed`); the write it fails is no news.
      let noKey = false;
      const text = asked.then((key) => {
        if (key === null) {
          noKey = true;
          throw new Error("no key to copy");
        }
        return new Blob([key], { type: "text/plain" });
      });
      try {
        clipboard.write([new ClipboardItem({ "text/plain": text })]).then(done, () => {
          if (!noKey) refused();
        });
        return;
      } catch {
        // A browser whose `ClipboardItem` takes no promise: the write below, after the answer.
        text.catch(() => {});
      }
    }
    void asked.then((key) => (key === null ? undefined : clipboard.writeText(key).then(done, refused)));
  };

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
            setRevealed(false);
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
