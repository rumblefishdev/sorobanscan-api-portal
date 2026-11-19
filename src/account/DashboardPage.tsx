import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { Navigate, useNavigate, useParams } from "react-router";

import { DashboardCard } from "../prices/landing/DashboardPanel";
import { LoginSection } from "../prices/landing/LoginSection";
import { color } from "../prices/theme/tokens";
import { AccountNavbar, SignOutFailed } from "./AccountNavbar";
import { CheckingCard, SessionFailedCard } from "./LoginPage";
import { PricesTab } from "./prices/PricesTab";
import { X402Tab } from "./x402/X402Tab";
import { ProductTabs, panelId, tabId } from "./ProductTabs";
import { enabledProducts, PRODUCT_NAME } from "./products";
import { useSignOut, type Session } from "./session";

/**
 * `/dashboard` and `/dashboard/<product>`: the Prices portal's dashboard (its `DashboardRoute`)
 * with a tab per API. The Prices tab is the Prices portal's dashboard, fed by the hub's backend
 * (`prices/PricesTab.tsx`); a tab still to be wired says so and shows no figures.
 *
 * A tab is open when the build turns its product on (`VITE_PRODUCTS`, `products.ts`); the others
 * are shown, marked "Coming soon", and can't be selected. The address names the open tab, and an
 * address that names a shut or unknown one is replaced by the first open tab's.
 */
export function DashboardPage({ session }: { session: Session }) {
  const { product: named } = useParams();
  const navigate = useNavigate();
  const enabled = enabledProducts(import.meta.env.VITE_PRODUCTS);
  const selected = enabled.find((product) => product === named) ?? enabled[0];
  const signOut = useSignOut();

  const head = (
    <>
      <title>Soroban Scan APIs — Dashboard</title>
      <meta name="robots" content="noindex" />
    </>
  );

  // Waits for the answer: going to `/login` while `/me` is in flight would send every arrival
  // from the sign-in back to the sign-in page.
  if (session.state === "loading") {
    return (
      <>
        {head}
        <LoginSection full>
          <CheckingCard />
        </LoginSection>
      </>
    );
  }
  // Not knowing who is signed in is not being signed out: a visitor who may well be signed in
  // stays here, told so, with a retry (review focus 4).
  if (session.state === "failed") {
    return (
      <>
        {head}
        <LoginSection full>
          <SessionFailedCard session={session} />
        </LoginSection>
      </>
    );
  }
  // Signed out, or nobody can sign in here: `/login` says which.
  if (session.state !== "signed_in") return <Navigate to="/login" replace />;
  // An address naming a tab that is shut or unknown takes the first open tab's place. Its query
  // isn't carried: an outcome in it was another tab's.
  if (named !== undefined && selected !== undefined && named !== selected) {
    return <Navigate to={`/dashboard/${selected}`} replace />;
  }

  return (
    <>
      {head}
      <AccountNavbar
        username={session.username}
        onSignOut={signOut.onSignOut}
        signingOut={signOut.state === "in_flight"}
        product={selected}
      />
      <Box
        component="main"
        sx={{
          position: "relative",
          overflow: "hidden",
          // Prices' dashboard floor, viewport-tall less the 52 px bar.
          backgroundColor: color.surface.background,
          minHeight: "calc(100dvh - 52px)",
          py: { xs: 4, md: 7 },
        }}
      >
        {/* Prices' dashboard grid, strongest behind the cards. Decorative. */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage: `
              linear-gradient(${alpha(color.stroke.default, 0.34)} 1px, transparent 1px),
              linear-gradient(90deg, ${alpha(color.stroke.default, 0.34)} 1px, transparent 1px)`,
            backgroundSize: "80px 80px, 80px 80px",
            maskImage: "radial-gradient(120% 70% at 50% 20%, #000 25%, transparent 80%)",
          }}
        />
        <Container sx={{ position: "relative" }}>
          <Stack spacing={3}>
            {/* Under the bar whose button it answers. */}
            {signOut.state === "failed" && <SignOutFailed />}
            <Stack spacing={1}>
              <Typography variant="h4" component="h1" color="text.primary">
                Dashboard
              </Typography>
              <Typography variant="body1" sx={{ color: color.text.tertiary }}>
                One tab for each API: its key, usage and limits.
              </Typography>
            </Stack>

            <ProductTabs
              name="dashboard"
              selected={selected}
              enabled={enabled}
              onSelect={(product) => navigate(`/dashboard/${product}`, { replace: true })}
            />

            {selected && (
              <Box
                role="tabpanel"
                id={panelId("dashboard", selected)}
                aria-labelledby={tabId("dashboard", selected)}
              >
                {selected === "prices" ? (
                  <PricesTab account={{ id: session.id, username: session.username }} />
                ) : selected === "x402" ? (
                  <X402Tab account={{ id: session.id, username: session.username }} />
                ) : (
                  <DashboardCard title={PRODUCT_NAME[selected]}>
                    <Typography variant="body1" sx={{ color: color.text.secondary }}>
                      Your {PRODUCT_NAME[selected]} key, usage and limits connect here in the next
                      step.
                    </Typography>
                  </DashboardCard>
                )}
              </Box>
            )}
          </Stack>
        </Container>
      </Box>
    </>
  );
}
