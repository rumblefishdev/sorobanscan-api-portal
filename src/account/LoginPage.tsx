import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import SwitchAccountRoundedIcon from "@mui/icons-material/SwitchAccountRounded";
import SyncProblemRoundedIcon from "@mui/icons-material/SyncProblemRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, Link as RouterLink, useSearchParams } from "react-router";

import { DiscordIcon } from "../prices/landing/DiscordIcon";
import {
  Benefits,
  Callout,
  DISCORD,
  LOGIN_CARD_MAX_WIDTH,
  LabelledRule,
  LoginCard,
} from "../prices/landing/LoginCard";
import { LoginSection } from "../prices/landing/LoginSection";
import {
  RUMBLEFISH_CONTACT,
  STELLAR_DISCORD_INVITE,
  STELLAR_DISCORD_SERVER,
} from "../prices/landing/links";
import { cardBorder } from "../prices/landing/primitives";
import { theme } from "../prices/theme/theme";
import { color, font, radius } from "../prices/theme/tokens";
import { SIGN_IN_URL, type Session } from "./session";

/**
 * `/login`: the Prices portal's sign-in card (its `LoginView` in `src/prices/app/app.tsx`), for the
 * hub's one sign-in. What differs from Prices' is only what doesn't apply here:
 *
 * - No popup. The button is a plain link to the hub's backend, which sends the browser to Discord
 *   and back to `/dashboard`, or here with `?signin=<reason>`. So the "Redirecting to Discord"
 *   waiting card is gone, and the OAuth error card, which Prices titles the same way, keeps the
 *   ordinary title.
 * - No key on sign-in (spec decision 4): the title, the subtitle and who may sign in are the hub's
 *   words; "What you get" keeps the two of Prices' four that hold for every API.
 *
 * Every refusal is Prices' wording for the same outcome, word for word, and so are the controls
 * that go with it.
 */

/** The card's headline and standfirst, the hub's: sign-in issues no key here. */
const LOGIN_TITLE = "Sign in";
const LOGIN_SUBTITLE = "One Discord sign-in for every Soroban Scan API.";

/** Prices' "What you get", less the two about its own key and quota. */
const BENEFITS = [
  { text: "Usage dashboard and key management", kind: "check" },
  { text: "Discord account is your identity", kind: "discord" },
] as const;

/** Why a sign-in ended without a session, as the hub's backend names it in `?signin=`. */
const REFUSALS = ["cancelled", "failed", "not_member", "pending_rules", "unknown"] as const;
type Refusal = (typeof REFUSALS)[number];

const isRefusal = (value: string | null): value is Refusal =>
  (REFUSALS as readonly (string | null)[]).includes(value);

/**
 * `?signin=`, read once and then taken off the address, as the Prices portal's
 * `useOneShotParams` does: the outcome stays on screen for this visit, and a reload, a bookmark or
 * Back shows no stale banner. `replace`, so the stripped address takes the entry's place.
 *
 * Not stripped for a signed-in visitor with no refusal to show: they are being sent to the
 * dashboard, and a second navigation, back to this page's own address, would undo that one.
 */
function useSigninOutcome(signedIn: boolean): Refusal | null {
  const [searchParams, setSearchParams] = useSearchParams();
  // Captured once per mount; StrictMode's rehearsal keeps state, so the capture survives it.
  const [outcome] = useState(() => {
    const value = searchParams.get("signin");
    return isRefusal(value) ? value : null;
  });
  const strip = !signedIn || outcome !== null;
  const present = searchParams.has("signin");
  const stripped = useRef(false);
  useEffect(() => {
    if (!strip || !present || stripped.current) return;
    stripped.current = true;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("signin");
        return next;
      },
      { replace: true },
    );
  }, [strip, present, setSearchParams]);
  return outcome;
}

export function LoginPage({ session }: { session: Session }) {
  const outcome = useSigninOutcome(session.state === "signed_in");

  // A signed-in visitor has nothing to do here, unless a round trip has just come back refused.
  // An issue's, left open past the 10 minutes its two halves last, ends here as a sign-in's
  // failure, since the hub can no longer tell what it was for; sent on without a word, the visitor
  // would meet a dashboard that says nothing of the key they asked for.
  if (session.state === "signed_in" && outcome === null) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <>
      {/* React 19 hoists both into `<head>`, over the hub's `index.html` title. */}
      <title>Soroban Scan APIs — Sign in</title>
      <meta name="robots" content="noindex" />
      <LoginSection full>
        <BackToLanding />
        {session.state === "loading" ? (
          <CheckingCard />
        ) : session.state === "unconfigured" ? (
          <UnconfiguredCard />
        ) : session.state === "failed" ? (
          <SessionFailedCard session={session} />
        ) : session.state === "signed_in" ? (
          <StillSignedInCard username={session.username} />
        ) : (
          <SignInCard outcome={outcome} />
        )}
      </LoginSection>
    </>
  );
}

/**
 * `/me` failed, so who is signed in is unknown: Prices' words for it (`SessionFailedCallout` in
 * `src/prices/app/app.tsx`) and its two ways on, asking again or signing in afresh. Signing in is
 * a top-level navigation of its own, so it doesn't depend on the request that just failed. The
 * dashboard shows this card too, rather than sending a visitor who may well be signed in to the
 * sign-in page.
 */
export function SessionFailedCard({
  session,
}: {
  session: Extract<Session, { state: "failed" }>;
}) {
  return (
    <LoginCard title={LOGIN_TITLE} titleComponent="h1" subtitle={LOGIN_SUBTITLE}>
      <Box role="alert">
        <Callout variant="error">
          <p data-testid="session-check-failed">
            Could not check your sign-in status: <code>{session.reason}</code>
          </p>
        </Callout>
      </Box>
      <Button
        type="button"
        variant="contained"
        fullWidth
        onClick={session.retry}
        sx={{ minHeight: 48 }}
      >
        Try again
      </Button>
      <DiscordButton href={SIGN_IN_URL}>Sign in with Discord</DiscordButton>
    </LoginCard>
  );
}

/**
 * A signed-in visitor back from a round trip that was refused (see `LoginPage`): their session is
 * as it was, and the dashboard is where to ask for a key again.
 */
function StillSignedInCard({ username }: { username: string }) {
  return (
    <LoginCard
      title="You are still signed in"
      titleComponent="h1"
      subtitle={LOGIN_SUBTITLE}
    >
      <Callout variant="neutral">
        <p data-testid="still-signed-in">
          That round trip through Discord did not complete, so nothing changed: you are still
          signed in as <strong>{username}</strong>. If you were getting an API key, ask for it again
          on your dashboard.
        </p>
      </Callout>
      <Button
        component={RouterLink}
        to="/dashboard"
        variant="contained"
        fullWidth
        sx={{ minHeight: 48 }}
      >
        Go to your dashboard
      </Button>
    </LoginCard>
  );
}

/** The card while the backend hasn't said who is signed in: Prices' words. */
export function CheckingCard() {
  return (
    <LoginCard title={LOGIN_TITLE} titleComponent="h1" subtitle={LOGIN_SUBTITLE}>
      <Callout variant="neutral" icon={<CircularProgress size={18} />}>
        <p>Checking whether you are signed in…</p>
      </Callout>
    </LoginCard>
  );
}

/**
 * The backend has no Discord settings (503 `sign_in_not_configured`): a dev server without
 * `.env.local`, say. No button, since there is nothing behind it.
 */
function UnconfiguredCard() {
  return (
    <LoginCard title={LOGIN_TITLE} titleComponent="h1" subtitle={LOGIN_SUBTITLE}>
      <Callout variant="neutral">
        <p data-testid="sign-in-unconfigured">Sign-in is not configured on this server.</p>
      </Callout>
    </LoginCard>
  );
}

/**
 * "‹ Back to landing" above the card, aligned to its left edge, as Prices' `LoginSection` draws
 * it. A plain link to the hub, `BASE_URL`: the landing page is another tree, not a route here.
 */
function BackToLanding() {
  return (
    <Box sx={{ width: "100%", maxWidth: LOGIN_CARD_MAX_WIDTH, alignSelf: "center" }}>
      <Link
        href={import.meta.env.BASE_URL}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          color: color.text.tertiary,
          textDecoration: "none",
          "&:hover": { color: color.text.primary },
        }}
      >
        <ChevronLeftRoundedIcon sx={{ fontSize: 20 }} />
        Back to landing
      </Link>
    </Box>
  );
}

/** The card for a signed-out visitor, with the refusal they came back with, if any. */
function SignInCard({ outcome }: { outcome: Refusal | null }) {
  const [switching, setSwitching] = useState(false);

  // Prices merges the two into one "OAuth error" screen (Adam, 2026-08-26); the backend still
  // names them apart in `?signin=` and in its log.
  if (outcome === "cancelled" || outcome === "failed") {
    return (
      <LoginCard
        title={LOGIN_TITLE}
        titleComponent="h1"
        subtitle={LOGIN_SUBTITLE}
        footer={<KeepsHappening />}
      >
        <Callout variant="error" title="OAuth error">
          <p data-testid="signin-failed">
            Discord returned an error during authorization. This can happen if you denied access or
            if the session timed out.
          </p>
        </Callout>
        <DiscordButton href={SIGN_IN_URL}>Try again with Discord</DiscordButton>
      </LoginCard>
    );
  }

  // A screen, not a banner, as in Prices: the sign-in button would hand a refused account straight
  // back to the same refusal, so the card offers the one action that changes the answer.
  if (outcome === "not_member" || outcome === "pending_rules") {
    const pendingRules = outcome === "pending_rules";
    return (
      <LoginCard
        title="Access not available"
        titleComponent="h1"
        subtitle={<>Your Discord account does not meet the requirements to receive an API key.</>}
        footer={<KeepsHappening />}
      >
        {pendingRules ? (
          <Callout variant="neutral" title="Stellar Discord accept rules required">
            <p data-testid="signin-pending-rules">
              Your Discord account is on the Stellar Developers server, but you have not accepted
              its rules yet. Open Discord, accept the server&apos;s rules, then sign in again.
            </p>
          </Callout>
        ) : (
          <Callout variant="neutral" title="Stellar Discord membership required">
            <p data-testid="signin-not-member">
              API keys are available to members of the{" "}
              <a href={STELLAR_DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
                Stellar Developers Discord
              </a>{" "}
              server. Join the server and try again.
            </p>
          </Callout>
        )}
        {/* In a new tab: the visitor comes back here to sign in again, and this card says how. */}
        {pendingRules ? (
          <DiscordButton href={STELLAR_DISCORD_SERVER} target="_blank">
            Open Stellar Discord
          </DiscordButton>
        ) : (
          <DiscordButton href={STELLAR_DISCORD_INVITE} target="_blank">
            Join Stellar Discord
          </DiscordButton>
        )}
        {pendingRules && <SignInAgain href={SIGN_IN_URL} />}
        <TryDifferentAccount onClick={() => setSwitching(true)} />
        {switching && <SwitchAccountDialog onClose={() => setSwitching(false)} />}
      </LoginCard>
    );
  }

  return (
    <LoginCard title={LOGIN_TITLE} titleComponent="h1" subtitle={LOGIN_SUBTITLE}>
      {/* Discord didn't answer: a banner over a button that still works, since retrying is the
          whole remedy. Never "not a member". */}
      {outcome === "unknown" && (
        <Callout
          variant="error"
          icon={<SyncProblemRoundedIcon sx={{ fontSize: 18 }} />}
          title="We could not check your membership"
        >
          <p data-testid="signin-unknown">
            That is a problem talking to Discord, not a statement about your membership. Please try
            signing in again shortly.
          </p>
        </Callout>
      )}
      {/* Who may sign in, above the button, as Prices states its prerequisites there: the hub's
          gate (spec decision 3), in the shape of Prices' line. */}
      <Typography
        variant="body2"
        data-testid="prerequisites"
        sx={{ color: color.text.tertiary, m: 0 }}
      >
        Signing in needs one thing, checked via Discord when you sign in: membership of the{" "}
        <a href={STELLAR_DISCORD_INVITE}>Stellar Developers Discord</a>, with its membership
        screening cleared (the server&apos;s rules accepted).
      </Typography>
      <DiscordButton href={SIGN_IN_URL}>Sign in with Discord</DiscordButton>
      <LabelledRule>What you get</LabelledRule>
      <Benefits items={BENEFITS} />
    </LoginCard>
  );
}

/*
 * The controls below are Prices' (`src/prices/app/app.tsx`), which keeps them private to its
 * `LoginView`: copied, less the popup they open there.
 */

/**
 * The card's primary control, in Discord's blurple. Always an `<a>`: a sign-in is a top-level
 * navigation, and the two refusal buttons send the visitor to discord.com in a new tab.
 */
function DiscordButton({
  href,
  target,
  children,
}: {
  href: string;
  /** `rel` follows from it, since `noopener` is not optional on a `_blank`. */
  target?: "_blank";
  children: ReactNode;
}) {
  return (
    <Button
      component="a"
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      variant="contained"
      fullWidth
      startIcon={<DiscordIcon />}
      sx={{
        backgroundColor: DISCORD,
        color: color.white,
        minHeight: 48,
        "&:hover": { backgroundColor: "#4752c4" },
      }}
    >
      {children}
    </Button>
  );
}

/** `pending_rules`' way back in: the same account, once the rules are accepted. */
function SignInAgain({ href }: { href: string }) {
  return (
    <Button
      component="a"
      href={href}
      fullWidth
      variant="outlined"
      data-testid="sign-in-again"
      sx={{
        minHeight: 48,
        ...theme.typography.body1,
        fontWeight: 700,
        color: color.text.primary,
        borderColor: color.stroke.default,
        "&:hover": {
          borderColor: color.text.primary,
          backgroundColor: alpha(color.gray[50], 0.06),
        },
      }}
    >
      Sign in again
    </Button>
  );
}

/** The refusal card's quiet second action: it opens `SwitchAccountDialog`. */
function TryDifferentAccount({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      fullWidth
      startIcon={<ChevronLeftRoundedIcon aria-hidden />}
      data-testid="switch-account-open"
      sx={{
        minHeight: 44,
        ...theme.typography.body1,
        fontWeight: 500,
        color: color.text.tertiary,
        "&:hover": {
          color: color.text.primary,
          backgroundColor: alpha(color.gray[50], 0.06),
        },
      }}
    >
      Try different account
    </Button>
  );
}

/** Where a visitor switches Discord account. Discord's, not ours. */
const DISCORD_LOGIN = "https://discord.com/login";

/**
 * "Use a different Discord account". Discord signs in whichever account it has a session for, and
 * OAuth gives no way to ask for a chooser, so the dialog says that and hands over the two steps
 * that work: switch on Discord (a new tab), then sign in again.
 */
function SwitchAccountDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="switch-account-title"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            backgroundColor: color.surface.gray,
            border: cardBorder,
            borderRadius: `${radius.lg}px`,
            p: { xs: 2.5, sm: 3 },
            m: 2,
          },
        },
        backdrop: { sx: { backgroundColor: alpha(color.black, 0.72) } },
      }}
    >
      <Stack spacing={2.5} data-testid="switch-account-dialog">
        <Box
          aria-hidden
          sx={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            backgroundColor: DISCORD,
            color: color.white,
          }}
        >
          <SwitchAccountRoundedIcon sx={{ fontSize: 28 }} />
        </Box>

        <Typography
          id="switch-account-title"
          component="h2"
          sx={{
            fontFamily: font.primary,
            fontWeight: 700,
            fontSize: { xs: "1.5rem", sm: "1.75rem" },
            lineHeight: 1.15,
            color: color.text.primary,
          }}
        >
          Use a different Discord account
        </Typography>

        <Typography
          data-testid="switch-account-explainer"
          sx={{ ...theme.typography.body1, color: color.text.secondary }}
        >
          Discord signs you in as whichever account it already has a session for, and we cannot
          change that from here. Switch account on Discord first, then come back and sign in again.
        </Typography>

        <Stack spacing={1.5}>
          <DiscordButton href={DISCORD_LOGIN} target="_blank">
            Switch account on Discord
          </DiscordButton>
          <Button
            component="a"
            href={SIGN_IN_URL}
            fullWidth
            variant="outlined"
            sx={{
              minHeight: 48,
              ...theme.typography.body1,
              fontWeight: 700,
              color: color.text.primary,
              borderColor: color.stroke.default,
              "&:hover": {
                borderColor: color.text.primary,
                backgroundColor: alpha(color.gray[50], 0.06),
              },
            }}
          >
            Try signing in again
          </Button>
          <Button
            type="button"
            onClick={onClose}
            fullWidth
            sx={{
              minHeight: 44,
              ...theme.typography.body2,
              fontWeight: 700,
              color: color.text.tertiary,
              "&:hover": {
                color: color.text.primary,
                backgroundColor: alpha(color.gray[50], 0.06),
              },
            }}
          >
            Cancel
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

/** A refusal card's footer: "If this keeps happening, contact support." */
function KeepsHappening() {
  return (
    <Typography variant="body2" sx={{ color: color.text.tertiary }}>
      If this keeps happening,{" "}
      <Box
        component="a"
        href={RUMBLEFISH_CONTACT}
        sx={{
          textDecoration: "underline",
          textUnderlineOffset: "0.2em",
          color: color.text.secondary,
        }}
      >
        contact support
      </Box>
      .
    </Typography>
  );
}
