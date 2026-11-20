import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import { lazy, Suspense } from "react";

import { Footer } from "../prices/landing/Chrome";
import { color } from "../prices/theme/tokens";
import { AccountNavbar, SignOutFailed } from "./AccountNavbar";
import { useSignOut, type Session } from "./session";

/**
 * `/privacy-policy`: the policy for every API, a page of this tree since 2026-11-20. It was the
 * Prices portal's own, at `/api/prices-api/privacy-policy`, which now sends the browser here
 * (`?from=prices`, which this page doesn't read: the address is the same page either way).
 *
 * Open to everybody and meant to be found, like the quick start and the reference
 * (`docs/DocsPage.tsx`): nothing waits for the session and no `noindex`. The bar is the same, with
 * "Log in" for a visitor who isn't signed in. The text is the Prices portal's reviewed policy,
 * with x402's paragraph added when the build turns x402 on (`PrivacyPolicy`).
 */

// A chunk of its own: a visitor who never opens the policy never downloads it.
const PrivacyPolicy = lazy(() => import("../prices/privacy/PrivacyPolicy"));

export function PrivacyPolicyPage({ session }: { session: Session }) {
  const signOut = useSignOut();
  const address = `${window.location.origin}${import.meta.env.BASE_URL}privacy-policy`;

  return (
    <>
      {/* React 19 hoists these into `<head>`, over the hub's `index.html` title. */}
      <title>Privacy policy — Soroban Scan APIs</title>
      <meta
        name="description"
        content="Which personal data the Soroban Scan APIs keep, from the Discord account you sign in with to the keys and requests of each API, why, and for how long."
      />
      <link rel="canonical" href={address} />
      {session.state === "signed_in" ? (
        <AccountNavbar
          username={session.username}
          onSignOut={signOut.onSignOut}
          signingOut={signOut.state === "in_flight"}
          current="privacy-policy"
        />
      ) : (
        // Not knowing who is signed in is no reason to hold the page back: it offers the
        // sign-in, which says what is wrong if anything is.
        <AccountNavbar
          current="privacy-policy"
          visitor={session.state === "loading" ? "pending" : "signed_out"}
        />
      )}
      {/* Under the bar whose button it answers, as on the dashboard. */}
      {signOut.state === "failed" && (
        <Box sx={{ backgroundColor: color.surface.background }}>
          <Container sx={{ pt: 3 }}>
            <SignOutFailed />
          </Container>
        </Box>
      )}
      <Suspense fallback={<PageLoading />}>
        <PrivacyPolicy />
      </Suspense>
      <Footer canOfferKey={false} hubDashboard={session.state === "signed_in"} />
    </>
  );
}

/**
 * The lazy page's place while its chunk loads: a screen tall, less the bar, so the footer doesn't
 * ride up under the spinner and jump back down.
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
      <CircularProgress size={28} aria-label="Loading the privacy policy" />
    </Stack>
  );
}
