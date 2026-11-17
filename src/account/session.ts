import { useEffect, useState } from "react";

/** The hub's backend (the BFF), under the page's own prefix and origin. */
const HUB = `${import.meta.env.BASE_URL}hub/`;
const ME_URL = `${HUB}me`;
const LOGOUT_URL = `${HUB}auth/logout`;

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
  | { state: "unconfigured" };

/**
 * The session, asked of `GET hub/me` once, on mount. Only a 200 whose body says
 * `authenticated: true` with an id and a username is signed in, and only a 503
 * `sign_in_not_configured` is unconfigured; every other answer, and none at all, is signed out,
 * so the pages offer sign-in whenever they can't tell.
 */
export function useSession(): Session {
  const [session, setSession] = useState<Session>({ state: "loading" });
  useEffect(() => {
    const asking = new AbortController();
    void readSession(asking.signal).then((answer) => {
      if (!asking.signal.aborted) setSession(answer);
    });
    return () => asking.abort();
  }, []);
  return session;
}

async function readSession(signal: AbortSignal): Promise<Session> {
  try {
    const response = await fetch(ME_URL, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    });
    if (response.status === 503) {
      const body: unknown = await response.json();
      return isRecord(body) && body.error === "sign_in_not_configured"
        ? { state: "unconfigured" }
        : { state: "signed_out" };
    }
    if (response.status !== 200) return { state: "signed_out" };
    const body: unknown = await response.json();
    if (
      isRecord(body) &&
      body.authenticated === true &&
      typeof body.id === "string" &&
      typeof body.username === "string"
    ) {
      return { state: "signed_in", id: body.id, username: body.username };
    }
    return { state: "signed_out" };
  } catch {
    return { state: "signed_out" };
  }
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
