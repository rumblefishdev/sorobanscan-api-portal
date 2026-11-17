import { useEffect, useState } from "react";

/** Where the hub's backend says who is signed in: under the page's own prefix and origin. */
const ME_URL = `${import.meta.env.BASE_URL}hub/me`;

/**
 * Whether a visitor is signed in, as the hub's backend says: `undefined` while it asks, once, on
 * mount. Only a 200 that says `authenticated: true` is signed in; every other answer, and none at
 * all, is signed out, so the page offers sign-in whenever it can't tell.
 */
export function useSignedIn(): boolean | undefined {
  const [signedIn, setSignedIn] = useState<boolean>();
  useEffect(() => {
    const asking = new AbortController();
    void isSignedIn(asking.signal).then((answer) => {
      if (!asking.signal.aborted) setSignedIn(answer);
    });
    return () => asking.abort();
  }, []);
  return signedIn;
}

async function isSignedIn(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(ME_URL, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    });
    if (response.status !== 200) return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" && body !== null && "authenticated" in body &&
      body.authenticated === true
    );
  } catch {
    return false;
  }
}
