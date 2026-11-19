import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import { lazy, Suspense, useLayoutEffect } from "react";
import { Navigate, useLocation, useNavigationType, useParams } from "react-router";

import type { ApiDocument } from "../../prices/docs/ApiReference";
import { Footer } from "../../prices/landing/Chrome";
import { QuickStart } from "../../prices/quickstart/QuickStart";
import { color } from "../../prices/theme/tokens";
import { AccountNavbar, SignOutFailed } from "../AccountNavbar";
import { ProductTabs, panelId, tabId } from "../ProductTabs";
import { enabledProducts, type Product } from "../products";
import { useSignOut, type Session } from "../session";

/**
 * `/quick-start/<api>` and `/docs/<api>`: every API's quick start and API reference, one page of
 * each kind with a tab per API (akot, 2026-11-19). They were the Prices portal's own pages, at
 * `/api/prices-api/quick-start` and `/api/prices-api/docs`, which now send the browser here.
 *
 * Open to everybody, and meant to be found: a reader deciding whether to sign in is who should
 * read them, and so are search engines and agents. So nothing here waits for the session, and no
 * page says `noindex`. The bar is the dashboard's, with "Log in" for a visitor who isn't signed in
 * (`AccountNavbar`).
 *
 * The address names the API. One that names none (`/quick-start`), a shut tab or an unknown one is
 * replaced by the first open tab's, keeping its `#part`: `/api/quick-start#examples` is a link the
 * Prices pages used to hand out.
 */

/** The two kinds of page, as their addresses name them. */
export type DocsKind = "quick-start" | "docs";

/** Each API's name where a page is about it alone: a title, a description. */
const API_NAME: Record<Product, string> = {
  prices: "Stellar Prices API",
  x402: "x402 Facilitator",
};

/** What a search result says under the title, per kind and API. */
const DESCRIPTION: Record<DocsKind, Record<Product, string>> = {
  "quick-start": {
    prices:
      "Get a first response from the Stellar Prices API in a few minutes: the key, the base URL, a first request and what the response means.",
    x402: "Charge per request on Stellar with the x402 Facilitator: protect a route, verify and settle payments, and get listed in the Bazaar.",
  },
  docs: {
    prices:
      "Every endpoint, parameter and response of the Stellar Prices API, rendered from its OpenAPI document.",
    x402: "Every endpoint, parameter and response of the x402 Facilitator for Stellar, rendered from its OpenAPI document.",
  },
};

/**
 * x402's OpenAPI document: a copy of `apps/facilitator/openapi.json` in
 * `rumblefishdev/stellar-x402`, in this bundle at `public/docs/x402/openapi.json`. The facilitator
 * doesn't serve the document itself yet, so the page renders the copy and says so (`served`).
 */
const X402_DOCUMENT: ApiDocument = {
  url: `${import.meta.env.BASE_URL}docs/x402/openapi.json`,
  download: `${import.meta.env.BASE_URL}docs/x402/openapi.json`,
  filename: "x402-facilitator-openapi.json",
  served: false,
};

// Chunks of their own, as in the Prices portal: a visitor who never opens a reference, or x402's
// quick start, never downloads it.
const ApiReference = lazy(() => import("../../prices/docs/ApiReference"));
const X402QuickStart = lazy(() =>
  import("./X402QuickStart").then((module) => ({ default: module.X402QuickStart })),
);

/**
 * Where a page opens, as the Prices portal's router placed its own pages (`useScrollOnNavigate` in
 * `src/prices/app/app.tsx`): at the `#part` its address names, once that part is drawn, and
 * otherwise at the top when a link brought the reader here, since a router link keeps the offset
 * of the page it was pressed on. Once per `page`: a link within the page is the browser's own
 * jump, and Back and Forward to an address without a part are the browser's to restore.
 */
function usePagePlace(page: string) {
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

export function DocsPage({ kind, session }: { kind: DocsKind; session: Session }) {
  const { product: named } = useParams();
  const { hash } = useLocation();
  const enabled = enabledProducts(import.meta.env.VITE_PRODUCTS);
  const selected = enabled.find((product) => product === named) ?? enabled[0];
  const signOut = useSignOut();
  usePagePlace(`${kind}/${selected}`);

  // A build that turns every API off has no page to show: the dashboard says so.
  if (selected === undefined) return <Navigate to="/dashboard" replace />;
  if (named !== selected) return <Navigate to={{ pathname: `/${kind}/${selected}`, hash }} replace />;

  const address = `${window.location.origin}${import.meta.env.BASE_URL}${kind}/${selected}`;
  const title =
    kind === "quick-start"
      ? `${API_NAME[selected]} quick start — Soroban Scan APIs`
      : `${API_NAME[selected]} reference — Soroban Scan APIs`;

  return (
    <>
      {/* React 19 hoists these into `<head>`, over the hub's `index.html` title. */}
      <title>{title}</title>
      <meta name="description" content={DESCRIPTION[kind][selected]} />
      <link rel="canonical" href={address} />
      {session.state === "signed_in" ? (
        <AccountNavbar
          username={session.username}
          onSignOut={signOut.onSignOut}
          signingOut={signOut.state === "in_flight"}
          current={kind}
          product={selected}
        />
      ) : (
        // Not knowing who is signed in is, here, no reason to hold the page back: it offers the
        // sign-in, which says what is wrong if anything is.
        <AccountNavbar
          current={kind}
          product={selected}
          visitor={session.state === "loading" ? "pending" : "signed_out"}
        />
      )}
      <Box sx={{ backgroundColor: color.surface.background }}>
        <Container sx={{ pt: { xs: 2, md: 3 } }}>
          <Stack spacing={2}>
            {/* Under the bar whose button it answers, as on the dashboard. */}
            {signOut.state === "failed" && <SignOutFailed />}
            <ProductTabs
              name="docs"
              selected={selected}
              enabled={enabled}
              hrefFor={(product) => `/${kind}/${product}`}
            />
          </Stack>
        </Container>
      </Box>
      <Box role="tabpanel" id={panelId("docs", selected)} aria-labelledby={tabId("docs", selected)}>
        <Suspense fallback={<PageLoading />}>
          {kind === "quick-start" ? (
            selected === "prices" ? (
              <QuickStart />
            ) : (
              <X402QuickStart />
            )
          ) : (
            // Keyed by the API: each tab's reference loads its own document and keeps no row of
            // the other's open.
            <ApiReference
              key={selected}
              source={selected === "x402" ? X402_DOCUMENT : undefined}
            />
          )}
        </Suspense>
      </Box>
      <Footer canOfferKey={false} hubDashboard={session.state === "signed_in"} />
    </>
  );
}

/**
 * A lazy page's place while its chunk loads: a screen tall, less the bar, so the footer doesn't
 * ride up under the spinner and jump back down (the Prices portal's `PageLoading`).
 */
function PageLoading() {
  return (
    <Stack
      alignItems="center"
      aria-busy="true"
      sx={{
        py: 12,
        minHeight: "calc(100dvh - 52px)",
        backgroundColor: color.surface.background,
      }}
    >
      <CircularProgress size={28} aria-label="Loading the page" />
    </Stack>
  );
}
