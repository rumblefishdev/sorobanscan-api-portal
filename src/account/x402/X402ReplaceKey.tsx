import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useState, type ChangeEvent } from "react";

import { REWORK_CONFIRM_PHRASE } from "../../prices/dashboard/ReplaceKey";
import { NoticeStrip } from "../../prices/landing/DashboardPanel";
import { cardBorder } from "../../prices/landing/primitives";
import { theme } from "../../prices/theme/theme";
import { color, font, radius } from "../../prices/theme/tokens";

/**
 * The "Regenerate" confirmation, x402's: the Prices portal's dialog (`ReplaceKey`) in its frame,
 * its typed phrase and its rules for a press (disabled until the phrase, and from the first press;
 * not dismissible mid-flight; a failure says the revoke wasn't confirmed and never that the key is
 * still working), with x402's words. Prices' would say "quota period" and that AWS takes half a
 * minute to apply a revoke; x402's rule is the calendar month (UTC), and a revoked key stops
 * working from the next request.
 */
export function X402ReplaceKey({
  onClose,
  onRevoked,
  revoke,
  describeFailure,
}: {
  onClose: () => void;
  onRevoked: (revoked: { revoked_at?: string; next_eligible_at?: string }) => void;
  /** Revokes the key: resolves to the revocation, rejects when it was not confirmed. */
  revoke: () => Promise<{ revoked_at?: string; next_eligible_at?: string }>;
  /** A rejection of `revoke`, as the failure line words it. */
  describeFailure: (cause: unknown) => string;
}) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const armed = typed === REWORK_CONFIRM_PHRASE;

  const onConfirm = () => {
    // Disabled from the first press, before the request is made: a second click in the window
    // before the answer must not start a second request.
    if (!armed || submitting) return;
    setSubmitting(true);
    setFailure(null);
    revoke()
      .then(onRevoked)
      .catch((cause: unknown) => {
        setFailure(describeFailure(cause));
        setSubmitting(false);
      });
  };

  return (
    <Dialog
      open
      // Not dismissible mid-flight: the answer has to land here, or the visitor can't tell whether
      // the key still works.
      onClose={submitting ? undefined : onClose}
      aria-labelledby="replace-key-title"
      aria-describedby="replace-key-warning"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            backgroundColor: color.surface.gray,
            border: cardBorder,
            borderRadius: `${radius.lg}px`,
            p: { xs: 2.5, sm: 3 },
            m: 2,
          },
        },
        backdrop: { sx: { backgroundColor: alpha(color.black, 0.72) } },
      }}
    >
      <Stack spacing={2.5} data-testid="replace-key-dialog">
        <Box
          aria-hidden
          sx={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            backgroundColor: color.primary[100],
            color: color.primary[900],
          }}
        >
          <AutorenewRoundedIcon sx={{ fontSize: 28 }} />
        </Box>

        <Typography
          id="replace-key-title"
          component="h2"
          sx={{
            fontFamily: font.primary,
            fontWeight: 700,
            fontSize: { xs: "1.5rem", sm: "1.75rem" },
            lineHeight: 1.15,
            color: color.text.primary,
          }}
        >
          Regenerate API key?
        </Typography>

        <Box id="replace-key-warning" data-testid="replace-key-warning">
          <Stack spacing={2}>
            <Typography sx={{ ...theme.typography.body1, color: color.text.secondary }}>
              Regenerating <strong>deactivates the current one</strong>. It stops working from the
              next request after you confirm, and anything still using it will break.
            </Typography>
            <NoticeStrip glyph={false} sx={{ py: 2.5 }}>
              <p>
                <strong>Important:</strong> regenerating is limited to once per calendar month, and{" "}
                <strong>no new key is issued now</strong>. You can generate a new one at the start
                of the next calendar month (<strong>the 1st of next month, 00:00 UTC</strong>), and
                until then you will not have a working key.
              </p>
            </NoticeStrip>
            <Typography sx={{ ...theme.typography.body2, color: color.text.tertiary }}>
              Do this if your key has leaked or you no longer trust where it is. If you only want a
              fresh key, wait for the next month instead.
            </Typography>
          </Stack>
        </Box>

        <Stack spacing={1} component="label">
          <Typography
            component="span"
            sx={{ ...theme.typography.body2, color: color.text.secondary }}
          >
            Type{" "}
            <Box
              component="code"
              sx={{
                fontFamily: font.mono,
                fontSize: "0.875em",
                color: color.text.accent,
                backgroundColor: color.surface.grayAlt,
                borderRadius: "4px",
                px: 0.75,
                py: 0.25,
              }}
            >
              {REWORK_CONFIRM_PHRASE}
            </Box>{" "}
            to confirm:
          </Typography>
          <Box
            component="input"
            type="text"
            value={typed}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            data-testid="replace-key-phrase"
            sx={{
              width: "100%",
              minHeight: 44,
              boxSizing: "border-box",
              px: 1.5,
              fontFamily: font.mono,
              fontSize: "0.9375rem",
              color: color.text.primary,
              backgroundColor: color.surface.grayAlt,
              border: `1px solid ${color.stroke.default}`,
              borderRadius: `${radius.chip}px`,
              "&:focus-visible": {
                outline: `2px solid ${color.stroke.action}`,
                outlineOffset: 2,
                borderColor: "transparent",
              },
              "&:disabled": { opacity: 0.6 },
            }}
          />
        </Stack>

        <Stack
          direction={{ xs: "column-reverse", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: "stretch", pt: 0.5, "& > *": { flex: 1 } }}
        >
          <Button
            type="button"
            onClick={onClose}
            disabled={submitting}
            sx={{
              ...theme.typography.body2,
              fontWeight: 700,
              color: color.text.primary,
              "&:hover": { backgroundColor: alpha(color.gray[50], 0.08) },
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={onConfirm}
            disabled={!armed || submitting}
            data-testid="replace-key-confirm"
            sx={{
              ...theme.typography.body2,
              fontWeight: 700,
              backgroundColor: color.surface.primary,
              color: color.black,
              "&:hover": { backgroundColor: color.primary[300] },
              "&.Mui-disabled": {
                backgroundColor: color.surface.grayAlt,
                color: color.text.tertiary,
              },
            }}
          >
            {submitting ? "Revoking…" : "Regenerate"}
          </Button>
        </Stack>

        {failure && (
          <Typography
            data-testid="replace-key-failed"
            role="alert"
            sx={{ ...theme.typography.body2, color: color.text.error }}
          >
            Could not confirm the revocation — your key may or may not have been switched off:{" "}
            <Box component="code" sx={{ fontFamily: font.mono, overflowWrap: "anywhere" }}>
              {failure}
            </Box>
            . Close this and reload the page to see where it stands, then try again if it is still
            live.
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
}
