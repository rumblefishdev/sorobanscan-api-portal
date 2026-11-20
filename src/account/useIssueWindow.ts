import { useEffect, useRef, useState, type FormEvent } from "react";

import { onOAuthPopupMessage, openOAuthPopup, POPUP_NAME } from "../prices/landing/oauthPopup";
import { issueOutcomeOf, type IssueOutcome } from "./prices/IssueOutcome";

/**
 * How long a shut window's verdict waits, so the window's own word can still overtake it, and how
 * often the page looks whether the window is still open. The sign-in's values (`LoginPage`).
 */
const POPUP_MESSAGE_GRACE_MS = 1500;
const POPUP_CLOSED_WATCH_MS = 500;

/** What a tab's "Get API Key" form needs of the window (`GetKeyForm`). */
export interface GetKeyControl {
  /** The round trip is running in the second window: the form is shut meanwhile. */
  waiting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * How the window's round trip ended, from the query of the address the backend left it at. An
 * issue's lands on its tab with `?issue=<outcome>`. One the backend could no longer tell was an
 * issue (its two halves outlived their 10 minutes, or the cookie was gone) lands on the sign-in
 * page with `?signin=<reason>`: no key was issued. Anything else says nothing, and the account
 * read that follows says what is so (a session that ended lands on the sign-in page with no query).
 */
function outcomeOf(search: string): IssueOutcome | null {
  const query = new URLSearchParams(search);
  return issueOutcomeOf(query.get("issue")) ?? (query.has("signin") ? "failed" : null);
}

/**
 * "Get API Key" in a second window, as the sign-in is (akot, 2026-11-20; `usePopupSignIn` in
 * `LoginPage.tsx`): the tab stays where it is while Discord's round trip runs in the window.
 *
 * The issue is still the form's own `POST` (`bff/src/app.ts`, `auth/issue`): `onSubmit` opens an
 * empty window and names it as the form's `target`, so the browser sends the same form, from this
 * page's origin and with the session, and shows the answer there. Where the browser opens no
 * window the form has no target and posts in the tab, as it always did: the tab then comes back
 * with `?issue=<outcome>` in its address (`useIssueOutcome`).
 *
 * While `waiting`, two things end the wait, and either way `onDone` is told, to read the account
 * again:
 *
 * - the window's own word. It lands where the backend sends it, where `src/boot.js` posts the
 *   address's query to this page and shuts the window (`bridgeOAuthPopup`): `outcome` is what it
 *   says ({@link outcomeOf});
 * - the window being shut, after {@link POPUP_MESSAGE_GRACE_MS} so its word can still arrive:
 *   nothing is known of how it went, so `outcome` is `null` and the account says what is so.
 *
 * `attempted` says a window was opened on this visit: its `outcome` then stands in for the one the
 * address came with.
 */
export function useIssueWindow(onDone: () => void): GetKeyControl & {
  attempted: boolean;
  outcome: IssueOutcome | null;
} {
  const [waiting, setWaiting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [outcome, setOutcome] = useState<IssueOutcome | null>(null);
  const popup = useRef<Window | null>(null);
  // The latest, without the wait starting over when the tab draws again.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!waiting) return;
    /** The wait is on: nothing has ended it yet. */
    let live = true;
    let grace: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      live = false;
      clearTimeout(grace);
      clearInterval(watchClosed);
      stopListening();
    };
    const end = (ended: IssueOutcome | null) => {
      if (!live) return;
      stop();
      setOutcome(ended);
      setWaiting(false);
      done.current();
    };

    const stopListening = onOAuthPopupMessage(({ search }) => end(outcomeOf(search)));
    const watchClosed = setInterval(() => {
      if (!live || grace !== undefined || !popup.current?.closed) return;
      grace = setTimeout(() => end(null), POPUP_MESSAGE_GRACE_MS);
    }, POPUP_CLOSED_WATCH_MS);

    // Leaving the tab ends the wait without a word: the window finishes by itself.
    return stop;
  }, [waiting]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    // An empty window first, within the press, where a browser still allows one; the form's
    // answer then loads in it. Not opened: no target, and the form posts in this tab.
    const opened = event.defaultPrevented ? null : openOAuthPopup("");
    form.target = opened ? POPUP_NAME : "";
    if (!opened) return;
    popup.current = opened;
    setAttempted(true);
    setOutcome(null);
    setWaiting(true);
  };

  return { waiting, attempted, outcome, onSubmit };
}
