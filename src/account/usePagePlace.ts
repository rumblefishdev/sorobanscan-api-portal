import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router";

/**
 * Where a page opens, as the Prices portal's router placed its own pages (`useScrollOnNavigate` in
 * `src/prices/app/app.tsx`): at the `#part` its address names, once that part is drawn, and
 * otherwise at the top when a link brought the reader here, since a router link keeps the offset
 * of the page it was pressed on. Once per `page`: a link within the page is the browser's own
 * jump, and Back and Forward to an address without a part are the browser's to restore.
 */
export function usePagePlace(page: string) {
  const { hash } = useLocation();
  const navigation = useNavigationType();
  // A layout effect, so a page a link opened is at the top before its first paint.
  useLayoutEffect(() => {
    if (!hash) {
      if (navigation === "PUSH" && window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      return;
    }
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape names no part of the page; look for it as written.
    }
    const jump = () => {
      const part = document.getElementById(id);
      // Optional call: jsdom has no `scrollIntoView`.
      part?.scrollIntoView?.({ behavior: "instant" });
      return part !== null;
    };
    if (jump()) return;
    // A lazy page draws its parts a chunk later, and a reference after its document: watch for
    // the part for 5 s; after that a jump would yank a reader who has started scrolling.
    const observer = new MutationObserver(() => {
      if (jump()) stop();
    });
    const timer = setTimeout(stop, 5000);
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    return stop;
    // No other dependency: the address the page opened at, and nothing after it.
  }, [page]);
}
