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
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
import { onOAuthPopupMessage, openOAuthPopup } from "../prices/landing/oauthPopup";
import { cardBorder } from "../prices/landing/primitives";
import { theme } from "../prices/theme/theme";
import { color, font, radius } from "../prices/theme/tokens";
import { PRODUCTS } from "./products";
import { SIGN_IN_URL, type Session } from "./session";

/**
 * `/login`: the Prices portal's sign-in card (its `LoginView` in `src/prices/app/app.tsx`), for the
 * hub's one sign-in. What differs from Prices' is only what doesn't apply here:
 *
 * - No key on sign-in (spec decision 4): the title, the subtitle and who may sign in are the hub's
 *   words; "What you get" keeps the three of Prices' four that hold for every API.
 * - The OAuth error card, which Prices titles "Redirecting to Discord", keeps the ordinary title.
 *
 * The round trip through Discord runs in a second window, as Prices' does (akot, 2026-11-19;
 * `usePopupSignIn`): this page stays, says it is waiting, and takes the outcome from the window
 * when it comes back. Where the browser allows no second window the button is the plain link it
 * always was: the backend sends this tab to Discord and back to `/dashboard`, or here with
 * `?signin=<reason>`.
 *
 * Every refusal is Prices' wording for the same outcome, word for word, and so are the controls
 * that go with it, but `busy`, the hub's backend's limit on its sign-in routes, which Prices
 * doesn't have: one line of the hub's own over the ordinary card.
 */

/** The card's headline and standfirst, the hub's: sign-in issues no key here. */
const LOGIN_TITLE = "Sign in";
const LOGIN_SUBTITLE = "One Discord sign-in for every Soroban Scan API.";

/**
 * Prices' "What you get", less the one about its own quota. Its first holds here too (akot,
 * 2026-11-19): sign-in issues no key, but the dashboard's "Get API Key" does at once.
 */
const BENEFITS = [
  { text: "Instant API key — no waiting", kind: "check" },
  { text: "Usage dashboard and key management", kind: "check" },
  { text: "Discord account is your identity", kind: "discord" },
] as const;

/**
 * How long a shut window's verdict waits, so the window's own word can still overtake it: the
 * window posts where it landed and closes in the same breath, and the watch may see it shut
 * before the message is delivered. Prices' value (`POPUP_MESSAGE_GRACE_MS`).
 */
const POPUP_MESSAGE_GRACE_MS = 1500;
/** How often the page asks the backend whether the window's sign-in is done. Prices' value. */
const POPUP_POLL_MS = 1500;
/** How often the page looks whether the window is still open. Prices' value. */
const POPUP_CLOSED_WATCH_MS = 500;

/**
 * Why a sign-in ended without a session, as the hub's backend names it in `?signin=`: its
 * callback's refusals, and `busy`, its limit's, which a round trip meets before Discord.
 */
const REFUSALS = ["cancelled", "failed", "not_member", "pending_rules", "unknown", "busy"] as const;
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

/**
 * The dashboard a signed-in visitor goes to from here: the tab of the product `?from=` names, as
 * the Prices pages send their sign-in here with `?from=prices` (the shared sign-in spec, cutover
 * step 3), or the dashboard itself. Only a product's name is read, compared whole against
 * {@link PRODUCTS}, never a path or an address, so the query can't send anyone off the dashboard.
 * A tab the build keeps shut is the dashboard's to replace.
 */
function useDashboardFrom(): string {
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from");
  return (PRODUCTS as readonly (string | null)[]).includes(from)
    ? `/dashboard/${from}`
    : "/dashboard";
}

/**
 * The sign-in in a second window, as the Prices portal's (`LoginView` in
 * `src/prices/app/app.tsx`, whose reasons its comments hold). `onSignInClick` goes on a link to
 * {@link SIGN_IN_URL}: it opens that address in a window of its own and takes the click only once
 * the window is open, so a blocked window, or a click that asks for a tab, is the plain link.
 *
 * While `waiting`, three things can end the wait:
 *
 * - the window's own word. It lands where the backend sends it, `/dashboard` or
 *   `/login?signin=<reason>`, where `src/boot.js` posts the address's query to this page and
 *   shuts the window (`bridgeOAuthPopup`). A refusal is shown as it is; anything else is checked
 *   with the backend, since a message is no proof of a session;
 * - the backend saying somebody is signed in, asked every {@link POPUP_POLL_MS}: the window's
 *   word can be lost (an opener the browser cut off), and the visitor would wait for good;
 * - the window being shut. After {@link POPUP_MESSAGE_GRACE_MS}, so its word can still arrive,
 *   the backend is asked: a visitor who finished and shut the window goes on signed in, any other
 *   is told the sign-in did not complete.
 *
 * `checkSignedIn` replaces the page's session only when somebody is signed in, and the page then
 * goes to the dashboard by itself. `attempted` says a window was opened on this visit: its
 * `outcome` then stands in for the one the address came with.
 */
function usePopupSignIn(checkSignedIn: () => Promise<boolean>) {
  const [waiting, setWaiting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [outcome, setOutcome] = useState<Refusal | null>(null);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    if (!waiting) return;
    /** The wait is on: nothing has ended it yet. */
    let live = true;
    /** The card is on screen: an answer that comes after it left changes nothing. */
    let shown = true;
    let grace: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      live = false;
      clearTimeout(grace);
      clearInterval(poll);
      clearInterval(watchClosed);
      stopListening();
    };
    const end = (refusal: Refusal | null) => {
      if (!shown) return;
      setOutcome(refusal);
      setWaiting(false);
    };
    /** The window is done, by its word or by being shut: the backend says how it went. */
    const confirm = () => {
      if (!live) return;
      stop();
      void checkSignedIn().then((signedIn) => end(signedIn ? null : "failed"));
    };

    const stopListening = onOAuthPopupMessage(({ search }) => {
      if (!live) return;
      const value = new URLSearchParams(search).get("signin");
      if (!isRefusal(value)) return confirm();
      stop();
      end(value);
    });
    const poll = setInterval(() => {
      // Not during the grace: the shut window's verdict is already on its way.
      if (!live || grace !== undefined) return;
      void checkSignedIn().then((signedIn) => {
        if (!signedIn || !live) return;
        stop();
        end(null);
      });
    }, POPUP_POLL_MS);
    const watchClosed = setInterval(() => {
      if (!live || grace !== undefined || !popup.current?.closed) return;
      grace = setTimeout(confirm, POPUP_MESSAGE_GRACE_MS);
    }, POPUP_CLOSED_WATCH_MS);

    return () => {
      shown = false;
      stop();
    };
  }, [waiting, checkSignedIn]);

  const onSignInClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A middle click or a modified one asks for a tab of its own: the browser's to answer.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const opened = openOAuthPopup(SIGN_IN_URL);
    if (!opened) return;
    event.preventDefault();
    popup.current = opened;
    setAttempted(true);
    setOutcome(null);
    setWaiting(true);
  };

  return { waiting, attempted, outcome, onSignInClick };
}

type OnSignInClick = (event: MouseEvent<HTMLAnchorElement>) => void;

export function LoginPage({
  session,
  checkSignedIn,
}: {
  session: Session;
  /** Asks the backend again who is signed in (`useSessionControl`). */
  checkSignedIn: () => Promise<boolean>;
}) {
  const fromAddress = useSigninOutcome(session.state === "signed_in");
  const dashboard = useDashboardFrom();
  const signIn = usePopupSignIn(checkSignedIn);
  // A window opened on this visit has the last word: a sign-in that worked there must not be
  // answered with the refusal an earlier one left in the address.
  const outcome = signIn.attempted ? signIn.outcome : fromAddress;

  // A signed-in visitor has nothing to do here, unless a round trip has just come back refused.
  // An issue's, left open past the 10 minutes its two halves last, ends here as a sign-in's
  // failure, since the hub can no longer tell what it was for; sent on without a word, the visitor
  // would meet a dashboard that says nothing of the key they asked for.
  if (session.state === "signed_in" && outcome === null) {
    return <Navigate to={dashboard} replace />;
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
          <StillSignedInCard
            username={session.username}
            dashboard={dashboard}
            busy={outcome === "busy"}
          />
        ) : signIn.waiting ? (
          <WaitingCard />
        ) : (
          <SignInCard outcome={outcome} onSignInClick={signIn.onSignInClick} />
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
 * as it was, and the dashboard, at `dashboard` (`useDashboardFrom`), is where to ask for a key
 * again. When the refusal was the backend's limit (`busy`), not before the minute is out, so the
 * card says that too.
 */
function StillSignedInCard({
  username,
  dashboard,
  busy,
}: {
  username: string;
  dashboard: string;
  busy: boolean;
}) {
  return (
    <LoginCard
      title="You are still signed in"
      titleComponent="h1"
      subtitle={LOGIN_SUBTITLE}
    >
      {busy && <TooManyAttempts />}
      <Callout variant="neutral">
        <p data-testid="still-signed-in">
          That round trip through Discord did not complete, so nothing changed: you are still
          signed in as <strong>{username}</strong>. If you were getting an API key, ask for it again
          on your dashboard.
        </p>
      </Callout>
      <Button
        component={RouterLink}
        to={dashboard}
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

/**
 * The card while the round trip runs in the second window: Prices' "Redirecting to Discord"
 * screen, word for word. "click here" is the same sign-in in this tab, for a visitor whose window
 * never showed.
 */
function WaitingCard() {
  return (
    <LoginCard
      title="Redirecting to Discord"
      titleComponent="h1"
      subtitle="A new window will open for you to authorize with Discord."
    >
      <Callout variant="discord" title="Discord authorization window opened.">
        Complete the sign-in there to continue. If nothing opened, <a href={SIGN_IN_URL}>click here</a>.
      </Callout>
      <Stack role="status" spacing={1.5} alignItems="center" sx={{ py: 2 }}>
        {/* Prices' spinner: an arc over a full ring, which MUI draws as two. */}
        <Box sx={{ position: "relative", display: "inline-flex" }}>
          <CircularProgress
            aria-hidden
            variant="determinate"
            value={100}
            size={44}
            thickness={3}
            sx={{ color: alpha(color.stroke.default, 0.45) }}
          />
          <CircularProgress size={44} thickness={3} sx={{ position: "absolute", left: 0 }} />
        </Box>
        <Typography variant="body1" color="text.primary">
          Waiting for Discord…
        </Typography>
        <Typography variant="body2" sx={{ color: color.text.tertiary }}>
          This page will update automatically.
        </Typography>
      </Stack>
    </LoginCard>
  );
}

/** The card for a signed-out visitor, with the refusal they came back with, if any. */
function SignInCard({
  outcome,
  onSignInClick,
}: {
  outcome: Refusal | null;
  /** Opens the sign-in in a second window (`usePopupSignIn`). */
  onSignInClick: OnSignInClick;
}) {
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
        <DiscordButton href={SIGN_IN_URL} onClick={onSignInClick}>
          Try again with Discord
        </DiscordButton>
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
        {pendingRules && <SignInAgain href={SIGN_IN_URL} onClick={onSignInClick} />}
        <TryDifferentAccount onClick={() => setSwitching(true)} />
        {switching && <SwitchAccountDialog onClose={() => setSwitching(false)} />}
      </LoginCard>
    );
  }

  return (
    <LoginCard title={LOGIN_TITLE} titleComponent="h1" subtitle={LOGIN_SUBTITLE}>
      {/* The backend's limit: a banner over a button that works again once the minute is out. */}
      {outcome === "busy" && <TooManyAttempts />}
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
      <DiscordButton href={SIGN_IN_URL} onClick={onSignInClick}>
        Sign in with Discord
      </DiscordButton>
      <LabelledRule>What you get</LabelledRule>
      <Benefits items={BENEFITS} />
    </LoginCard>
  );
}

/**
 * `busy`: the hub's backend refused the round trip before Discord, over its limit on the sign-in
 * routes from one address (`bff/src/app.ts`). The tab's banner says the same for "Get API Key"
 * (`IssueBanner`).
 */
function TooManyAttempts() {
  return (
    <Callout variant="error">
      <p data-testid="signin-busy">
        Too many sign-in attempts from your network. Try again in a minute.
      </p>
    </Callout>
  );
}

/*
 * The controls below are Prices' (`src/prices/app/app.tsx`), which keeps them private to its
 * `LoginView`: copied.
 */

/**
 * The card's primary control, in Discord's blurple. Always an `<a>`: a sign-in is a top-level
 * navigation, in this tab when no second window opens, and the two refusal buttons send the
 * visitor to discord.com in a new tab.
 */
function DiscordButton({
  href,
  target,
  onClick,
  children,
}: {
  href: string;
  /** `rel` follows from it, since `noopener` is not optional on a `_blank`. */
  target?: "_blank";
  onClick?: OnSignInClick;
  children: ReactNode;
}) {
  return (
    <Button
      component="a"
      href={href}
      target={target}
      onClick={onClick}
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
function SignInAgain({ href, onClick }: { href: string; onClick: OnSignInClick }) {
  return (
    <Button
      component="a"
      href={href}
      onClick={onClick}
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
