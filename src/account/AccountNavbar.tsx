import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { Link as RouterLink } from "react-router";

import { Wordmark } from "../prices/landing/Chrome";
import { DiscordIcon } from "../prices/landing/DiscordIcon";
import { API_REFERENCE, HUB_DASHBOARD, HUB_LOGIN, QUICKSTART } from "../prices/landing/links";
import { Callout } from "../prices/landing/LoginCard";
import { cardBorder } from "../prices/landing/primitives";
import { color, font, radius } from "../prices/theme/tokens";
import type { Product } from "./products";

/**
 * The pages the bar is drawn over: this tree's dashboard, quick start, API reference and privacy
 * policy, and the Prices portal's landing page.
 */
export type AccountNavbarPage =
  | "dashboard"
  | "quick-start"
  | "docs"
  | "landing"
  | "privacy-policy";

/** The pages among them that are this tree's own, which the bar reaches by router links. */
const OWN_PAGES: readonly AccountNavbarPage[] = [
  "dashboard",
  "quick-start",
  "docs",
  "privacy-policy",
];

/**
 * The bar's height, less its border, at each width: one 52 px row from `sm`; at `xs` two, the
 * wordmark (24 px) over the links and Sign out (its 44 px target), the row's 16 px `gap` between.
 * The bar's floor, and the height of its place while a Prices page asks the hub who is signed in
 * (`EmptyBar` in `src/prices/app/app.tsx`), so the page doesn't move when the bar is drawn.
 */
export const ACCOUNT_NAVBAR_HEIGHT = { xs: 24 + 16 + 44, sm: 52 };

/**
 * The dashboard's bar: the Prices portal's signed-in bar (`DashboardNavbar` in
 * `src/prices/landing/DashboardChrome.tsx`), drawn the same, with this tree's links.
 *
 * Its measures and the reasons for them (two rows at 375 px, a named sign-out at every width) are
 * Prices'; see its comments.
 *
 * The quick start and the API reference are pages of this tree, one for every API (akot,
 * 2026-11-19; `docs/DocsPage.tsx`), and open to a visitor who isn't signed in: the bar is over
 * them for everybody, with "Log in" where the account and Sign out would be (`visitor`). The
 * Prices portal's landing page and privacy policy draw the bar too (akot, 2026-11-19; `PageBar`
 * in `src/prices/app/app.tsx`), so every page of the APIs has the one bar. A link is a route of
 * the tree the bar is drawn in and a plain link from the other tree: under the other tree's
 * basename a router link would name a page of that one.
 */
export function AccountNavbar({
  username,
  onSignOut,
  signingOut = false,
  current = "dashboard",
  product,
  visitor,
}: {
  /** Who is signed in. Not read with `visitor`. */
  username?: string;
  onSignOut?: () => void;
  /** A sign-out is in flight: the button is shut, so a second press sends no second `POST`. */
  signingOut?: boolean;
  /**
   * The page the bar is over, whose link is underlined. The privacy policy and the Prices
   * portal's landing page are under the bar and not in it, so nothing is underlined there.
   */
  current?: AccountNavbarPage;
  /** The API the page under the bar is about: the bar's links then open that API's tab. */
  product?: Product;
  /**
   * Nobody is signed in, on a page that needs nobody to be: `signed_out` offers "Log in" and no
   * Dashboard; `pending`, while the backend hasn't said, offers neither, so neither flashes up
   * for the wrong visitor.
   */
  visitor?: "signed_out" | "pending";
}) {
  const ownTree = OWN_PAGES.includes(current);
  const tab = product ? `/${product}` : "";
  // From the Prices portal's page, each link opens the Prices tab, as plain links.
  const links: { label: string; to?: string; href?: string; current: boolean }[] = [
    ...(visitor
      ? []
      : [
          {
            label: "Dashboard",
            ...(ownTree ? { to: `/dashboard${tab}` } : { href: HUB_DASHBOARD }),
            current: current === "dashboard",
          },
        ]),
    {
      label: "Quick start",
      ...(ownTree ? { to: `/quick-start${tab}` } : { href: QUICKSTART }),
      current: current === "quick-start",
    },
    {
      label: "OpenAPI Docs",
      ...(ownTree ? { to: `/docs${tab}` } : { href: API_REFERENCE }),
      current: current === "docs",
    },
  ];

  return (
    <Box
      component="nav"
      aria-label={visitor ? "Documentation" : "Dashboard"}
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        backgroundColor: alpha(color.surface.backgroundAlt, 0.85),
        backdropFilter: "blur(12px)",
        borderBottom: cardBorder,
      }}
    >
      <Container>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            minHeight: ACCOUNT_NAVBAR_HEIGHT,
            gap: 2,
            flexWrap: { xs: "wrap", sm: "nowrap" },
          }}
        >
          <Wordmark />

          <Stack
            direction="row"
            alignItems="center"
            spacing={{ xs: 1, sm: 1.5, md: 3 }}
            useFlexGap
            sx={{
              minWidth: 0,
              width: { xs: "100%", sm: "auto" },
              justifyContent: { xs: "space-between", sm: "flex-start" },
              flexWrap: { xs: "wrap", sm: "nowrap" },
            }}
          >
            {links.map(({ label, to, href, current }) => (
              <Link
                key={label}
                {...(to ? { component: RouterLink, to } : { href })}
                aria-current={current ? "page" : undefined}
                sx={{
                  display: "inline",
                  whiteSpace: "nowrap",
                  fontFamily: font.secondary,
                  fontSize: { xs: "0.875rem", sm: "0.9375rem" },
                  fontWeight: 500,
                  textDecoration: "none",
                  color: current ? color.text.primary : color.text.tertiary,
                  borderBottom: current
                    ? `2px solid ${color.primary[400]}`
                    : "2px solid transparent",
                  px: current ? 1 : 0,
                  pb: "4px",
                  "&:hover": { color: color.text.primary },
                }}
              >
                {label}
              </Link>
            ))}

            {visitor === "signed_out" && (
              // To the sign-in, which comes back to this API's tab of the dashboard.
              <Button
                {...(ownTree
                  ? { component: RouterLink, to: product ? `/login?from=${product}` : "/login" }
                  : { component: "a", href: HUB_LOGIN })}
                variant="contained"
                size="small"
                sx={{ flexShrink: 0, minHeight: 36, px: 2, whiteSpace: "nowrap" }}
              >
                Log in
              </Button>
            )}
            {!visitor && (
              <>
                <Box
                  aria-hidden
                  sx={{
                    display: { xs: "none", sm: "block" },
                    width: "1px",
                    height: 24,
                    flexShrink: 0,
                    backgroundColor: alpha(color.stroke.default, 0.6),
                  }}
                />

                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ minWidth: 0, display: { xs: "none", sm: "flex" } }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      flexShrink: 0,
                      width: 26,
                      height: 26,
                      borderRadius: "8px",
                      display: "grid",
                      placeItems: "center",
                      backgroundColor: "#5865f2",
                      color: color.white,
                    }}
                  >
                    <DiscordIcon sx={{ fontSize: 16 }} />
                  </Box>
                  <Typography
                    sx={{
                      fontFamily: font.secondary,
                      fontWeight: 700,
                      fontSize: "0.9375rem",
                      color: color.text.primary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {username}
                  </Typography>
                </Stack>

                {/* A real `<button>`: signing out is a POST, not a navigation. */}
                <Stack
                  component="button"
                  type="button"
                  onClick={onSignOut}
                  disabled={signingOut}
                  aria-label="Sign out"
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    flexShrink: 0,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    p: 0,
                    minWidth: 44,
                    minHeight: 44,
                    justifyContent: "center",
                    fontFamily: font.secondary,
                    fontSize: "0.9375rem",
                    fontWeight: 500,
                    color: color.text.tertiary,
                    "&:hover": { color: color.text.primary },
                    "&:disabled": { cursor: "progress", opacity: 0.6, color: color.text.tertiary },
                  }}
                >
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                    Sign out
                  </Box>
                  <Box
                    aria-hidden
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: `${radius.pill}px`,
                      display: "grid",
                      placeItems: "center",
                      backgroundColor: color.primary[400],
                      color: color.black,
                    }}
                  >
                    <LogoutRoundedIcon sx={{ fontSize: 14 }} />
                  </Box>
                </Stack>
              </>
            )}
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}

/**
 * What the page under the bar says when Sign out didn't work (`useSignOut`'s `failed`): this
 * browser is still signed in. An `alert`, so a screen reader says it when it appears.
 */
export function SignOutFailed() {
  return (
    <Box role="alert">
      <Callout variant="error">
        <p>Sign-out failed. Try again.</p>
      </Callout>
    </Box>
  );
}
