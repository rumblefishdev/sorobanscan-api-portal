import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { DashboardCard } from "../prices/landing/DashboardPanel";
import { Callout } from "../prices/landing/LoginCard";
import { LoginSection } from "../prices/landing/LoginSection";
import { cardBorder } from "../prices/landing/primitives";
import { color, font, radius } from "../prices/theme/tokens";
import { AccountNavbar } from "./AccountNavbar";
import { CheckingCard } from "./LoginPage";
import { enabledProducts, PRODUCT_NAME, PRODUCTS, type Product } from "./products";
import { signOut, type Session } from "./session";

/**
 * `/dashboard` and `/dashboard/<product>`: the Prices portal's dashboard (its `DashboardRoute`)
 * with a tab per API. Each tab will show its product's key, usage and limits from the hub's
 * backend; until that is wired, the open tab says so and shows no figures.
 *
 * A tab is open when the build turns its product on (`VITE_PRODUCTS`, `products.ts`); the others
 * are shown, marked "Coming soon", and can't be selected. The address names the open tab, and an
 * address that names a shut or unknown one shows the first open tab.
 */
export function DashboardPage({ session }: { session: Session }) {
  const { product: named } = useParams();
  const navigate = useNavigate();
  const enabled = enabledProducts(import.meta.env.VITE_PRODUCTS);
  const selected = enabled.find((product) => product === named) ?? enabled[0];
  const [signingOut, setSigningOut] = useState<"idle" | "in_flight" | "failed">("idle");

  // The button is shut while the `POST` is out, so one press is one sign-out. A sign-out that
  // worked leaves the page, so the button stays shut; one that didn't keeps the dashboard and
  // says so, since this browser is still signed in.
  const onSignOut = async () => {
    if (signingOut === "in_flight") return;
    setSigningOut("in_flight");
    if (!(await signOut())) setSigningOut("failed");
  };

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
  // Signed out, or nobody can sign in here: `/login` says which.
  if (session.state !== "signed_in") return <Navigate to="/login" replace />;

  return (
    <>
      {head}
      <AccountNavbar
        username={session.username}
        onSignOut={() => void onSignOut()}
        signingOut={signingOut === "in_flight"}
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
            {/* Under the bar whose button it answers; `alert`, so a screen reader says it when
                it appears. */}
            {signingOut === "failed" && (
              <Box role="alert">
                <Callout variant="error">
                  <p>Sign-out failed. Try again.</p>
                </Callout>
              </Box>
            )}
            <Stack spacing={1}>
              <Typography variant="h4" component="h1" color="text.primary">
                Dashboard
              </Typography>
              <Typography variant="body1" sx={{ color: color.text.tertiary }}>
                One tab for each API: its key, usage and limits.
              </Typography>
            </Stack>

            <Tabs
              value={selected ?? false}
              onChange={(_, product: Product) => {
                // A click on a shut tab opens nothing. Tab and the arrow keys don't reach it (MUI
                // gives an unselected tab `tabIndex=-1` and its arrow keys skip `aria-disabled`
                // ones), but a screen reader's browse mode still reads its "Coming soon".
                if (enabled.includes(product)) {
                  navigate(`/dashboard/${product}`, { replace: true });
                }
              }}
              aria-label="APIs"
              sx={{
                minHeight: 0,
                borderBottom: cardBorder,
                "& .MuiTabs-indicator": { backgroundColor: color.primary[400], height: 2 },
              }}
            >
              {PRODUCTS.map((product) => {
                const open = enabled.includes(product);
                return (
                  <Tab
                    key={product}
                    value={product}
                    id={tabId(product)}
                    // Only the selected tab's panel is rendered; the others would point at nothing.
                    aria-controls={product === selected ? panelId(product) : undefined}
                    aria-disabled={open ? undefined : true}
                    disableRipple={!open}
                    label={
                      <Stack component="span" direction="row" spacing={1} alignItems="center">
                        <span>{PRODUCT_NAME[product]}</span>
                        {!open && <ComingSoon />}
                      </Stack>
                    }
                    sx={{
                      minHeight: 44,
                      px: 2,
                      textTransform: "none",
                      fontFamily: font.secondary,
                      fontSize: "0.9375rem",
                      fontWeight: 500,
                      color: color.text.tertiary,
                      "&.Mui-selected": { color: color.text.primary },
                      ...(!open && { cursor: "default", "&:hover": { color: color.text.tertiary } }),
                      ...(open && { "&:hover": { color: color.text.primary } }),
                    }}
                  />
                );
              })}
            </Tabs>

            {selected && (
              <Box
                role="tabpanel"
                id={panelId(selected)}
                aria-labelledby={tabId(selected)}
              >
                <DashboardCard title={PRODUCT_NAME[selected]}>
                  <Typography variant="body1" sx={{ color: color.text.secondary }}>
                    Your {PRODUCT_NAME[selected]} key, usage and limits connect here in the next
                    step.
                  </Typography>
                </DashboardCard>
              </Box>
            )}
          </Stack>
        </Container>
      </Box>
    </>
  );
}

const tabId = (product: Product) => `dashboard-tab-${product}`;
const panelId = (product: Product) => `dashboard-panel-${product}`;

/** The shut tab's mark: Prices' muted status pill, as spans, since it sits inside a button. */
function ComingSoon() {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        py: 0.25,
        borderRadius: `${radius.chip}px`,
        backgroundColor: color.surface.grayAlt,
        color: color.text.tertiary,
        fontSize: "0.75rem",
        fontWeight: 700,
        lineHeight: 1.5,
      }}
    >
      Coming soon
    </Box>
  );
}
