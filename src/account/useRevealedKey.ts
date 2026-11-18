import { useEffect, useRef, useState } from "react";

/**
 * What a tab's key card does with the key's value, the same for Prices and x402: asked of the hub
 * once, on the first press that needs it (Show key or Copy key); shown or hidden; copied. The value
 * lives in this hook's state and nowhere else, and goes with the component that uses it.
 */
export function useRevealedKey({
  fetchKey,
  isGone,
  describeFailure,
  onGone,
  isNotViewable,
  onNotViewable,
}: {
  /** The tab's `key/reveal`. */
  fetchKey: () => Promise<{ value: string }>;
  /** Whether a failure says the key is gone: the account is to be read again (`onGone`). */
  isGone: (cause: unknown) => boolean;
  /** A failure in words, for the line under the key. */
  describeFailure: (cause: unknown) => string;
  onGone: () => void;
  /** x402 only: a failure that says the key can't be shown, which `onNotViewable` takes in. */
  isNotViewable?: (cause: unknown) => boolean;
  onNotViewable?: () => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealFailure, setRevealFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailure, setCopyFailure] = useState<string | null>(null);
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

  /** The key's value, asked of the hub the first time: `null` when it can't be had. */
  const reveal = (): Promise<string | null> => {
    if (value !== null) return Promise.resolve(value);
    if (asking.current) return asking.current;
    setRevealing(true);
    setRevealFailure(null);
    const pending = fetchKey()
      .then(
        (key) => {
          if (live.current) setValue(key.value);
          return key.value;
        },
        (cause: unknown) => {
          if (live.current) {
            if (isGone(cause)) onGone();
            else if (isNotViewable?.(cause)) onNotViewable?.();
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

  return {
    value,
    revealed,
    revealing,
    revealFailure,
    copied,
    copyFailure,
    onShow,
    onCopy,
    /** Back to the mask, as a revoke leaves it. */
    hide: () => setRevealed(false),
  };
}
