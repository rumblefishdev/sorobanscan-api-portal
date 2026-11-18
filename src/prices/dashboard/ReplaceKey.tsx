/**
 * The "Regenerate" confirmation — moved from `app/app.tsx`, for the Prices portal's dashboard
 * and the hub's Prices tab alike. The one change in the move: the revoke and the wording of its
 * failure are the caller's (`revoke`, `describeFailure`), since the two pages reach Prices
 * through different backends.
 */

import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useState, type ChangeEvent } from 'react';

import type { PortalKeyRevoked, PortalRevocation } from '../api/portal';
import { NoticeStrip } from '../landing/DashboardPanel';
import { cardBorder } from '../landing/primitives';
import { theme } from '../theme/theme';
import { color, font, radius } from '../theme/tokens';
import { PROPAGATION_COPY } from './dates';

/**
 * The phrase that arms the regeneration.
 *
 * ⚠️ **`regenerate-key`, not task 0191's `delete-key` — Adam, 2026-08-26.**
 * The phrase follows the button: the control has said "Regenerate" since
 * 2026-08-25, and a dialog that demands the word `delete` under a heading that
 * says "Regenerate" is asking the visitor to agree to a different sentence
 * from the one they just read. 0191's REASON for having a typed phrase at all
 * — that this is destructive and must not be reachable by one stray click —
 * is untouched; only the string changed.
 */
const REWORK_CONFIRM_PHRASE = 'regenerate-key';

/**
 * The "Regenerate" confirmation (task 0191's dialog, task 0193's frame).
 *
 * A real modal since 0193: MUI's `Dialog`, so it takes the focus, traps it,
 * closes on `Escape` and dims the dashboard behind it — the frame draws a
 * floating card over a darkened page, and the inline `<section>` this replaced
 * could do none of that. It renders through a portal, OUTSIDE the dashboard
 * chrome's descendant rules, so every element here is styled locally; nothing
 * it draws can be inherited.
 *
 * **The WORDING is task 0191's and is still not re-decided here**, with the
 * two exceptions Adam made by hand and which are marked as such: the verb is
 * "regenerate" (the frame's, and the button's since 2026-08-25) and the typed
 * phrase is `regenerate-key`. Every load-bearing sentence is 0191's:
 *
 * - the current key is **deactivated**, within the propagation window rather
 *   than "immediately", so anything still using it breaks;
 * - **no new key is issued now** — regenerating is a revocation with a dated
 *   replacement, not a swap. If a swap handed out a fresh key (a fresh
 *   counter), this would be the button people press on the 20th of a heavy
 *   month.
 * - Confirm is **disabled until the visitor types the phrase**, and disabled
 *   again the moment it is pressed, so a double-click cannot fire two
 *   requests. The press is the caller's `revoke`, a same-origin `POST` (the
 *   portal's `revokeKey`, the hub tab's `POST hub/prices/key/revoke`) — no
 *   Discord round-trip, so a leaked key is killable while Discord is down.
 *
 * **Where the frame and this build disagree, this build is what ships.** The
 * frame's "Important" box reads "Rotation is limited to once per calendar
 * month. After regenerating you will not be able to rotate again until
 * <date>", which describes a product that hands you a new key on the spot.
 * This one does not: it deactivates and issues nothing until the period rolls
 * ([[0191]]'s model, and the settled rotation-vs-revocation answer). The box
 * keeps its position, its ring and its two-colour treatment, and states what
 * actually happens.
 *
 * On success the parent renders the revoked state with the exact date from the
 * backend's answer; on failure the dialog says so and stays open, with the key
 * still live — "revoked" is never shown for a key that still works.
 *
 * **The failure copy holds the other half of that invariant, and it is the
 * weaker half.** "Revoked" is decidable from the response; "still active" is
 * not. A `502` can be a control-plane refusal with nothing written, or a lost
 * response on an `UpdateApiKey` that landed — the page cannot tell, so it says
 * what it knows (the deactivation was not confirmed) and never asserts the key
 * is still working. The partly-succeeded case does not arrive here at all: the
 * backend answers `200 partial`, and the revoked view renders the warning.
 */
export function ReplaceKey({
  onClose,
  onRevoked,
  revoke,
  describeFailure,
}: {
  onClose: () => void;
  onRevoked: (revoked: PortalKeyRevoked) => void;
  /** Revokes the key: resolves to the revocation, rejects when it was not confirmed. */
  revoke: () => Promise<PortalRevocation>;
  /** A rejection of `revoke`, as the failure line words it. */
  describeFailure: (cause: unknown) => string;
}) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const armed = typed === REWORK_CONFIRM_PHRASE;

  const onConfirm = () => {
    // Disabled from the first press, before the request is even made: a
    // second click in the window before the answer must not start a second
    // request. The state change re-renders the button disabled synchronously.
    if (!armed || submitting) return;
    setSubmitting(true);
    setFailure(null);
    revoke()
      .then((revoked) => {
        onRevoked({
          revoked: true,
          next_eligible_at: revoked.next_eligible_at,
          revoked_at: revoked.revoked_at,
          partial: revoked.partial,
        });
      })
      .catch((cause: unknown) => {
        setFailure(describeFailure(cause));
        setSubmitting(false);
      });
  };

  return (
    <Dialog
      open
      // Not dismissible mid-flight: a backdrop click or `Escape` while the
      // `POST` is in the air would unmount the one place the answer has to
      // land, and the visitor would be left not knowing whether their key
      // still works — the single thing this dialog exists to never do.
      onClose={submitting ? undefined : onClose}
      aria-labelledby="replace-key-title"
      aria-describedby="replace-key-warning"
      // `sm` (600), not `xs` (444): the frame's card is wide enough that the
      // warning runs two lines rather than four, and the height that buys
      // back is what keeps the whole dialog — badge, rule, input and both
      // controls — on one screen at laptop height without scrolling.
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            // The card colour, not `MuiPaper`'s default darkest surface: the
            // frame floats this ABOVE the dashboard, and the one surface a
            // raised element takes here is the card's.
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
      {/* The testid rides the content, not the `Paper`: MUI 7 types
          `slotProps.paper` against `PaperProps`, which admits no `data-*`, and
          reaching the element would mean casting the slot's props — a lie in
          the type system bought for an attribute that works just as well one
          node in. `role="dialog"` and the labelling stay on the `Paper`, where
          the accessibility tree wants them. */}
      <Stack spacing={2.5} data-testid="replace-key-dialog">
        {/* The frame's badge: a cream disc with the brand's own darkest
            yellow as the glyph. `aria-hidden` — the heading under it is the
            label, and "autorenew icon" announced first is noise. */}
        <Box
          aria-hidden
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
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
            fontSize: { xs: '1.5rem', sm: '1.75rem' },
            lineHeight: 1.15,
            color: color.text.primary,
          }}
        >
          Regenerate API key?
        </Typography>

        {/* One `data-testid` over BOTH halves of the warning, because both
            halves are the warning: the deactivation sentence and the rule in
            the ringed box are what task 0191 decided had to be said, and the
            tests that pin that copy read this subtree's text. Splitting the
            testid would let one half be deleted with the suite still green. */}
        <Box id="replace-key-warning" data-testid="replace-key-warning">
          <Stack spacing={2}>
            <Typography
              sx={{ ...theme.typography.body1, color: color.text.secondary }}
            >
              Regenerating <strong>deactivates the current one</strong>. It
              stops working {PROPAGATION_COPY} of your confirming — AWS takes
              that long to apply the change, so treat it as live until then —
              and anything still using it will break.
            </Typography>
            {/* Taller than the dashboard's strip (Adam, 2026-08-26): with the
                disc gone the text runs the full width of the box, and 12 px
                top and bottom against a three-line paragraph reads as a
                caption rather than the rule the visitor has to weigh. */}
            <NoticeStrip glyph={false} sx={{ py: 2.5 }}>
              <p>
                <strong>Important:</strong> regenerating is limited to once per
                quota period, and <strong>no new key is issued now</strong>. You
                can generate a new one at the start of the next quota period (
                <strong>the 1st of next month, 00:00 UTC</strong>), and until
                then you will not have a working key.
              </p>
            </NoticeStrip>
            <Typography
              sx={{ ...theme.typography.body2, color: color.text.tertiary }}
            >
              Do this if your key has leaked or you no longer trust where it is.
              If you only want a fresh key, wait for the next period instead.
            </Typography>
          </Stack>
        </Box>

        {/* The typed phrase, under the rule it confirms rather than beside the
            button it arms: the visitor should have read what they are agreeing
            to before there is anywhere to type. */}
        <Stack spacing={1} component="label">
          <Typography
            component="span"
            sx={{ ...theme.typography.body2, color: color.text.secondary }}
          >
            Type{' '}
            <Box
              component="code"
              sx={{
                fontFamily: font.mono,
                fontSize: '0.875em',
                color: color.text.accent,
                backgroundColor: color.surface.grayAlt,
                borderRadius: '4px',
                px: 0.75,
                py: 0.25,
              }}
            >
              {REWORK_CONFIRM_PHRASE}
            </Box>{' '}
            to confirm:
          </Typography>
          <Box
            component="input"
            type="text"
            value={typed}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setTyped(event.target.value)
            }
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            data-testid="replace-key-phrase"
            sx={{
              width: '100%',
              minHeight: 44,
              boxSizing: 'border-box',
              px: 1.5,
              fontFamily: font.mono,
              fontSize: '0.9375rem',
              color: color.text.primary,
              backgroundColor: color.surface.grayAlt,
              border: `1px solid ${color.stroke.default}`,
              borderRadius: `${radius.chip}px`,
              '&:focus-visible': {
                outline: `2px solid ${color.stroke.action}`,
                outlineOffset: 2,
                borderColor: 'transparent',
              },
              '&:disabled': { opacity: 0.6 },
            }}
          />
        </Stack>

        {/* The frame's footer: cancel as quiet text, the destructive action in
            the brand fill on the right. Reversed at `xs` into a column with
            the primary action on top, because at 375 px a side-by-side pair
            puts the confirm under the thumb of somebody scrolling. */}
        <Stack
          direction={{ xs: 'column-reverse', sm: 'row' }}
          spacing={1.5}
          // The pair spans the card (Adam, 2026-08-26) rather than sitting
          // right-aligned as the frame draws it: equal halves, so neither
          // reading of "which one is the safe one" is decided by width. At
          // `xs` they stack, and the destructive one stays on TOP of the
          // reversed column — the thumb rests at the bottom of a phone.
          sx={{ alignItems: 'stretch', pt: 0.5, '& > *': { flex: 1 } }}
        >
          <Button
            type="button"
            onClick={onClose}
            disabled={submitting}
            sx={{
              ...theme.typography.body2,
              fontWeight: 700,
              color: color.text.primary,
              '&:hover': { backgroundColor: alpha(color.gray[50], 0.08) },
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
              '&:hover': { backgroundColor: color.primary[300] },
              '&.Mui-disabled': {
                backgroundColor: color.surface.grayAlt,
                color: color.text.tertiary,
              },
            }}
          >
            {submitting ? 'Deactivating…' : 'Regenerate'}
          </Button>
        </Stack>

        {failure && (
          <Typography
            data-testid="replace-key-failed"
            role="alert"
            sx={{ ...theme.typography.body2, color: color.text.error }}
          >
            Could not confirm the deactivation — your key may or may not have
            been switched off:{' '}
            {/* The face is set here for the same reason the notice's margin
                is: the dashboard chrome's `& code` rule does not reach a
                dialog rendered through a portal, and a failure reason in the
                body face is the one string on this screen a visitor may have
                to copy into a support message. */}
            <Box
              component="code"
              sx={{ fontFamily: font.mono, overflowWrap: 'anywhere' }}
            >
              {failure}
            </Box>
            . Close this and reload the page to see where it stands, then try
            again if it is still live.
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
}
