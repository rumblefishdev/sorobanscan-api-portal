import { useCallback, useEffect, useState } from "react";

/** The hub's backend (the BFF), under the page's own prefix and origin. */
export const HUB = `${import.meta.env.BASE_URL}hub/`;
const ME_URL = `${HUB}me`;
const LOGOUT_URL = `${HUB}auth/logout`;

/**
 * How long the page waits for `/me` before it says it couldn't tell. `fetch` has no timeout of
 * its own, and a backend that accepts and never answers would leave the dashboard on "Checking
 * whether you are signed in…" for good.
 */
export const ME_TIMEOUT_MS = 10_000;

/**
 * Where "Sign in with Discord" goes: the backend sends the browser on to Discord. A plain link,
 * since the round trip is a top-level navigation `fetch` can't make.
 */
export const SIGN_IN_URL = `${HUB}auth/login`;

/** Who is signed in, as the hub's backend says. */
export type Session =
  | { state: "loading" }
  | { state: "signed_out" }
  | { state: "signed_in"; id: string; username: string }
  /** The backend has no Discord settings (503 `sign_in_not_configured`): nobody can sign in. */
  | { state: "unconfigured" }
  /**
   * `/me` failed, didn't answer in {@link ME_TIMEOUT_MS}, or answered what isn't the backend's
   * answer: who is signed in is unknown. `reason` says which, `retry` asks again.
   */
  | { state: "failed"; reason: string; retry: () => void };

type Answer = Exclude<Session, { state: "failed" }> | { state: "failed"; reason: string };

/**
 * The session, asked of `GET hub/me` on mount and on `retry`. Only a 200 whose body says
 * `authenticated: true` with an id and a username is signed in, only one that says
 * `authenticated: false` is signed out, and only a 503 `sign_in_not_configured` is unconfigured.
 * Every other answer, and none, is `failed`: a backend that is down or slow must not send a
 * signed-in visitor to the sign-in page as though they were signed out (the shared sign-in spec,
 * "Found in review of the local sign-in").
 */
export function useSession(): Session {
  const [answer, setAnswer] = useState<Answer>({ state: "loading" });
  /** Bumped by `retry`: each value is one more ask. */
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let live = true;
    const asking = new AbortController();
    // A timer, not `AbortSignal.timeout`: it stops with the ask it belongs to.
    const deadline = setTimeout(() => asking.abort(), ME_TIMEOUT_MS);
    void readSession(asking.signal).then((read) => {
      clearTimeout(deadline);
      if (live) setAnswer(read);
    });
    return () => {
      live = false;
      clearTimeout(deadline);
      asking.abort();
    };
  }, [asked]);

  const retry = useCallback(() => {
    setAnswer({ state: "loading" });
    setAsked((n) => n + 1);
  }, []);

  return answer.state === "failed" ? { ...answer, retry } : answer;
}

async function readSession(signal: AbortSignal): Promise<Answer> {
  const failed = (reason: string): Answer => ({ state: "failed", reason });
  // Aborted only by the deadline as far as anyone reads: an unmount's answer is dropped.
  const late = () => failed(`${ME_URL} did not answer within ${ME_TIMEOUT_MS / 1000} s`);
  let response: Response;
  try {
    response = await fetch(ME_URL, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return signal.aborted ? late() : failed(`${ME_URL} could not be reached`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // The CDN in front of the backend answers its own page, with 200, for a 403 or 404.
    return signal.aborted ? late() : failed(`${ME_URL} answered ${response.status}, not JSON`);
  }
  if (response.status === 503 && isRecord(body) && body.error === "sign_in_not_configured") {
    return { state: "unconfigured" };
  }
  if (response.status !== 200) return failed(`${ME_URL} answered ${response.status}`);
  if (isRecord(body) && body.authenticated === false) return { state: "signed_out" };
  if (
    isRecord(body) &&
    body.authenticated === true &&
    typeof body.id === "string" &&
    typeof body.username === "string"
  ) {
    return { state: "signed_in", id: body.id, username: body.username };
  }
  return failed(`${ME_URL} answered 200 without a sign-in status`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Sign out: `POST hub/auth/logout`. Only its 204 clears the session cookie, and only then does the
 * browser go to the hub's landing page (`BASE_URL`), as a full load, so every tree there asks
 * `/me` afresh; `true`. Any other answer, or none, leaves this browser signed in, so the page
 * stays where it is and says so: `false`.
 */
export async function signOut(): Promise<boolean> {
  try {
    const response = await fetch(LOGOUT_URL, { method: "POST", credentials: "same-origin" });
    if (response.status !== 204) return false;
  } catch {
    return false;
  }
  location.assign(import.meta.env.BASE_URL);
  return true;
}

/** Where a bar's Sign out is: `in_flight` while its `POST` is out, `failed` when it didn't work. */
export type SignOutState = "idle" | "in_flight" | "failed";

/**
 * The hub bar's Sign out, on the dashboard and on the Prices pages it draws that bar over. The
 * button is shut while the `POST` is out, so one press is one sign-out. A sign-out that worked
 * leaves the page, so the button stays shut; one that didn't keeps the page and says so, since
 * this browser is still signed in.
 */
export function useSignOut(): { state: SignOutState; onSignOut: () => void } {
  const [state, setState] = useState<SignOutState>("idle");
  const onSignOut = () => {
    if (state === "in_flight") return;
    setState("in_flight");
    void signOut().then((left) => {
      if (!left) setState("failed");
    });
  };
  return { state, onSignOut };
}
