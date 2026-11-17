import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { Link as RouterLink } from "react-router";

import { Wordmark } from "../prices/landing/Chrome";
import { DiscordIcon } from "../prices/landing/DiscordIcon";
import { API_REFERENCE, QUICKSTART } from "../prices/landing/links";
import { cardBorder } from "../prices/landing/primitives";
import { color, font, radius } from "../prices/theme/tokens";

/**
 * The dashboard's bar: the Prices portal's signed-in bar (`DashboardNavbar` in
 * `src/prices/landing/DashboardChrome.tsx`), drawn the same, with this tree's links.
 *
 * Not Prices' own component: its Quick start and OpenAPI Docs are routes of the Prices router,
 * and in this tree's router they would resolve to `/api/quick-start`. Here they are plain links
 * to the Prices pages; only "Dashboard" is a route of this tree. Its measures and the reasons for
 * them (two rows at 375 px, a named sign-out at every width) are Prices'; see its comments.
 */
export function AccountNavbar({
  username,
  onSignOut,
  signingOut = false,
}: {
  username: string;
  onSignOut: () => void;
  /** A sign-out is in flight: the button is shut, so a second press sends no second `POST`. */
  signingOut?: boolean;
}) {
  const links = [
    { label: "Dashboard", to: "/dashboard", current: true },
    { label: "Quick start", href: QUICKSTART, current: false },
    { label: "OpenAPI Docs", href: API_REFERENCE, current: false },
  ];

  return (
    <Box
      component="nav"
      aria-label="Dashboard"
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
          sx={{ minHeight: 52, gap: 2, flexWrap: { xs: "wrap", sm: "nowrap" } }}
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
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
