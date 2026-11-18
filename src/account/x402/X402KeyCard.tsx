import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useEffect, useRef, useState } from "react";
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
import { theme } from "../../prices/theme/theme";
import { color, radius } from "../../prices/theme/tokens";
import { IssueBanner, type IssueOutcome } from "../prices/IssueOutcome";
import type { Account } from "../prices/KeyCard";
import {
  describeFailure,
  HubError,
  isSignedOut,
  isUnavailable,
  ISSUE_URL,
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
 * without its usage, plan and rate limit, which x402 has none of; its rule is the calendar month
 * (UTC). Copied rather than shared, since the parts that differ run through the whole of it.
 *
 * - **No key**: "Get API Key", a form `POST` to the hub with `product=x402`.
 * - **Active**: the key masked, shown and copied through `key/reveal` on a press; "Regenerate"
 *   revokes through `key/revoke`, behind a typed phrase, and issues nothing.
 * - **Revoked**: when, and when a new key can be had; "Get API Key" once it can.
 * - The `?issue=` outcome the visitor came back with, above all of it.
 */
export function X402KeyCard({
  view,
  outcome,
  account,
  showable,
  onReload,
  onRevoked,
}: {
  view: AccountView;
  outcome: IssueOutcome | null;
  account: Account;
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

      {key?.state === "none" && !settling && <NoKey keyState={key} account={account} />}
      {key?.state === "active" && (
        <ActiveKey
          // A new key is a new card: nothing shown or copied of the old one carries over.
          key={key.key_id}
          showable={showable}
          onGone={onReload}
          onRevoked={onRevoked}
        />
      )}
      {key?.state === "revoked" && <RevokedKey keyState={key} />}

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

/**
 * "Get API Key": a real form, not a `fetch`. The issue is a round trip through Discord, a
 * top-level navigation; the hub reads the product from an urlencoded body only, and refuses a
 * `POST` that doesn't name this page as its origin, which the browser does for a form.
 */
function GetKeyForm() {
  return (
    <Box
      component="form"
      method="post"
      action={ISSUE_URL}
      data-testid="get-api-key"
      sx={{ display: "flex", justifyContent: "center" }}
    >
      <input type="hidden" name="product" value="x402" />
      <Button
        type="submit"
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
    </Box>
  );
}

/** The `Dashboard - no key` frame: the red strip, then the one action. */
function NoKey({
  keyState,
  account,
}: {
  keyState: Extract<X402Key, { state: "none" }>;
  account: Account;
}) {
  return (
    <>
      <NoticeStrip tone="error">
        <p data-testid="no-key-notice">
          No API key found for your account. If you contact us, quote your Discord ID{" "}
          <code data-testid="no-key-discord-id">{account.id}</code>.
        </p>
      </NoticeStrip>
      {keyState.can_issue && <GetKeyForm />}
    </>
  );
}

/** A revoked key: when it stopped working, and when a new one can be had. */
function RevokedKey({ keyState }: { keyState: Extract<X402Key, { state: "revoked" }> }) {
  const on = describeUtcDay(keyState.revoked_at);
  return (
    <Stack spacing={2} data-testid="key-revoked">
      <p>
        Your key was revoked{on ? ` on ${on}` : ""}.{" "}
        {keyState.can_issue
          ? "A new key can be issued now."
          : `A new key can be issued from ${dayOr(keyState.next_eligible_at)}.`}
      </p>
      {keyState.can_issue && <GetKeyForm />}
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
  const [value, setValue] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealFailure, setRevealFailure] = useState<string | null>(null);
  /** `reveal` said `key_not_viewable`: the key can't be shown, whatever the account said. */
  const [notViewable, setNotViewable] = useState(false);
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
  // "Copied." for two seconds, so a second copy shows it worked too.
  useEffect(() => {
    if (!copied) return;
    const clearing = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(clearing);
  }, [copied]);

  const viewable = showable && !notViewable;

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
            else if (cause instanceof HubError && cause.code === "key_not_viewable") {
              setNotViewable(true);
            } else setRevealFailure(describeFailure(cause));
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
    // Absent on an insecure origin; said rather than thrown.
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
    // WebKit lets a page write the clipboard only from within the press, and the key is a round
    // trip away until it has been shown. So the write starts here: the key itself when it is
    // held, or a `ClipboardItem` holding the promise of it, which the browser waits on.
    if (value !== null) {
      clipboard.writeText(value).then(done, refused);
      return;
    }
    // One reveal for the press, whichever way it is written.
    const asked = reveal();
    if (typeof ClipboardItem === "function" && typeof clipboard.write === "function") {
      // A failed reveal says why itself; the write it fails is no news.
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
    void asked.then((key) =>
      key === null ? undefined : clipboard.writeText(key).then(done, refused),
    );
  };

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
