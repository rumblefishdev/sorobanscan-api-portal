/**
 * Small pieces of the Prices dashboard — moved from `app/app.tsx` unchanged, so the Prices
 * portal's dashboard and the hub's Prices tab (`src/account/prices`) are drawn from one copy.
 */

import type ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import type { PortalKeyRevoked } from '../api/portal';
import { cardBorder } from '../landing/primitives';
import { theme } from '../theme/theme';
import { color, font, radius } from '../theme/tokens';
import { PROPAGATION_COPY, describeUtcInstant, revokedJustNow } from './dates';

/**
 * The frame's underline on a footer's named destinations — the OAuth error
 * card's "contact support".
 *
 * ⚠️ **Underlined at Adam's instruction (2026-08-26).** "contact support" is
 * an `<a>` since task 0301 (`RUMBLEFISH_CONTACT`). The card's "status page"
 * shared this underline as a `<span>` until task 0305 cut it — see
 * `KeepsHappening`. (The legal footer that used to share the same rule is no
 * longer rendered at all — see the note below `UNDERLINED`.)
 */
export const UNDERLINED = {
  textDecoration: 'underline',
  textUnderlineOffset: '0.2em',
  color: color.text.secondary,
} as const;

/**
 * The circled glyph inside a dashboard button — the frame's treatment.
 *
 * Both controls carry one: a black disc with a yellow glyph on the yellow
 * button, a yellow disc with a black glyph on the dark one. The same shape the
 * landing page's `ArrowBadge` draws, and a real element rather than a bordered
 * icon for the same reason: the two variants differ by colour alone.
 *
 * `aria-hidden`, always — the word beside it is the label.
 */
export function GlyphBadge({
  icon: Icon,
  tone,
}: {
  icon: typeof ContentCopyRoundedIcon;
  tone: 'onPrimary' | 'onDark';
}) {
  const onPrimary = tone === 'onPrimary';
  return (
    <Box
      aria-hidden
      sx={{
        width: 24,
        height: 24,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        backgroundColor: onPrimary ? color.black : color.primary[400],
        color: onPrimary ? color.primary[400] : color.black,
      }}
    >
      <Icon sx={{ fontSize: 14 }} />
    </Box>
  );
}

/**
 * One big yellow number with its unit, from the Rate Limit card. A value that
 * is the whole statement ("Unlimited", task 0311) is passed without a unit.
 */
export function Figure({
  label,
  value,
  unit,
  testId,
}: {
  label: string;
  value: number | string;
  /** Omitted when the value is the whole statement ("Unlimited", task 0311). */
  unit?: string;
  testId?: string;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" sx={{ color: color.text.tertiary }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography
          component="span"
          sx={{
            fontFamily: font.primary,
            fontWeight: 700,
            // 36px: measured 27px of cap height on the frame's "60", where
            // 2rem gives 23.
            fontSize: '2.25rem',
            lineHeight: 1,
            color: color.text.accent,
          }}
          data-testid={testId}
        >
          {value}
        </Typography>
        {unit !== undefined && (
          <Typography variant="body2" sx={{ color: color.text.secondary }}>
            {unit}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

/**
 * "Your API key was deactivated on <date>. It stopped working within about
 * half a minute of that instant…" — task 0191's sentence, and the only copy in
 * this file that two screens share.
 *
 * Extracted 2026-08-26 when the revoked dashboard arrived: it is stated both
 * in that card's Reason box and, for a PARTIAL revocation, in the ordinary
 * dashboard's key panel. Two copies of a decided sentence is how the two
 * wordings drift apart.
 *
 * The `<strong data-testid="revoked-at">` and the tense switch are 0191's and
 * are not re-decided here: the present tense holds only while the propagation
 * window is still open, because this same sentence renders days later on the
 * reveal path, where "treat it as live" would be false.
 */
export function DeactivationSentence({ revoked }: { revoked: PortalKeyRevoked }) {
  const at = describeUtcInstant(revoked.revoked_at);
  const fresh = revokedJustNow(revoked.revoked_at);
  return (
    <p>
      Your API key was deactivated
      {at && (
        <>
          {' on '}
          <strong data-testid="revoked-at">{at}</strong>
        </>
      )}
      {fresh
        ? `. It stops working ${PROPAGATION_COPY}${
            at ? ' of that instant' : ''
          } — until then treat it as live — and anything still using it will break.`
        : `. It stopped working ${PROPAGATION_COPY}${
            at ? ' of that instant' : ''
          }, and anything still using it is broken.`}
    </p>
  );
}

/**
 * The wrapper that styles the plain markup tasks 0186 to 0192 own.
 *
 * Shared by the landing's status panel and the dashboard route, because both
 * render that markup and neither may rewrite it — see the long note inside.
 */
export function PortalStatusChrome({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 3,

        // ---------------------------------------------------------------
        // Descendant styling, NOT a component rewrite.
        //
        // Everything below this heading is tasks 0186 to 0192's markup —
        // plain `<p>`, `<a>`, `<button>`, `<code>` — and every sentence in it
        // is copy those tasks decided. Task 0193's rule is that it re-decides
        // none of it, so this slice styles the ELEMENTS and leaves the tree
        // alone: no wording moves, no control changes role, no `data-testid`
        // is touched, and the 84 tests that pin that copy keep passing
        // unaltered.
        //
        // The alternative — rewriting each branch into MUI components — would
        // have meant retyping ~40 pieces of decided copy by hand, which is
        // exactly the way the reason behind a wording gets lost.
        //
        // It is deliberately scoped to this panel rather than put in
        // `CssBaseline`: a global bare-`<a>` rule would also repaint the
        // landing sections above, where every link is already a themed
        // component.
        // ---------------------------------------------------------------
        '& p': {
          ...theme.typography.body1,
          color: color.text.secondary,
          margin: 0,
        },
        '& a': {
          color: color.text.accent,
          textUnderlineOffset: '0.2em',
        },
        // ⚠️ `& p code`, NOT `& code`. The grey chip belongs to code quoted
        // inside a sentence — `X-API-Key`, `/v1/`, a failure reason — and to
        // nothing else. As `& code` it also painted the two places the frame
        // draws bare: the key itself, inside its yellow ring, and the Key ID
        // in the metadata row. Both tried to opt out with their own
        // `backgroundColor` and neither could: `.chrome code` is one class
        // plus one type, which outranks the single class Emotion puts on the
        // element's own `sx`. Narrowing the rule is the fix; raising the
        // other side's specificity would have been a fight with no end.
        '& p code': {
          fontFamily: font.mono,
          fontSize: '0.875em',
          backgroundColor: color.surface.gray,
          borderRadius: '4px',
          px: 0.75,
          py: 0.25,
          overflowWrap: 'anywhere',
        },
        // Everything else that is `<code>` keeps the face and nothing else.
        '& code': { fontFamily: font.mono, overflowWrap: 'anywhere' },
        // The first-login card's second control. A link, so it keeps `& a`'s
        // semantics, but the frame draws it as a button-height row of white
        // text with the circled arrow rather than as accent-coloured prose.
        '& a[data-variant="quiet"]': {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 44,
          ...theme.typography.body2,
          fontWeight: 700,
          color: color.text.primary,
          textDecoration: 'none',
        },
        '& button[data-variant="primary"]': {
          backgroundColor: `${color.surface.primary} !important`,
          borderColor: 'transparent !important',
          color: `${color.black} !important`,
          '&:hover': { backgroundColor: `${color.primary[300]} !important` },
        },
        // ⚠️ **Plain `<button>` only — never a MUI one** (Adam, 2026-08-26).
        //
        // This rule is `.chrome button`: one class plus one type, which
        // outranks the single class Emotion puts on a component's own `sx`. It
        // was written for the bare markup tasks 0186–0192 left in this panel,
        // but it reached every MUI `Button` rendered inside the chrome too and
        // overrode what they asked for. The revoked card's "Sign out" is the
        // one that showed it: the frame draws a bare label and it came out as
        // a dark grey pill, because a `text` Button sets no background of its
        // own and had nothing to win the cascade with. Its yellow sibling
        // escaped only because `.MuiButton-contained` is two classes.
        //
        // Narrowed rather than fought with `!important` on the other side —
        // the same fix, and the same reasoning, as `& p code` above.
        '& button:not([class*="MuiButton-root"])': {
          ...theme.typography.body2,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          // 36 to match the frame, with the touch-target floor restored where
          // a finger is doing the pressing — the same trade the navbar's one
          // control makes, and for the same reason: 44 everywhere made the
          // dashboard's buttons visibly taller than the mock.
          minHeight: 36,
          '@media (pointer: coarse)': { minHeight: 44 },
          paddingInline: '16px',
          borderRadius: `${radius.pill}px`,
          // Measured: the frame's secondary button is a fill one step DARKER
          // than the card body it sits on, with no border at all. The old
          // `surface.gray` + hairline is now the colour of the body itself.
          border: 'none',
          backgroundColor: color.surface.grayAlt,
          color: color.text.primary,
          alignSelf: 'flex-start',
          '&:hover': { backgroundColor: color.black },
        },
        '& hr': {
          width: '100%',
          border: 0,
          borderTop: cardBorder,
          margin: 0,
        },
        // The link that starts the issue round-trip gets the brand button,
        // because it is the primary action of whichever state renders it — a
        // page whose whole purpose is "get a key" should not present that as
        // the same underlined text as a Discord invite three lines up.
        //
        // Matched on `href` rather than on a class or a wrapper: the URL comes
        // from `issueUrl()` in `api/portal.ts`, so the selector tracks the
        // route and not a styling hook somebody could remove without noticing.
        // It stays an `<a>` — an OAuth flow is a top-level navigation and
        // `fetch` cannot perform one, which is the reason task 0189 made it a
        // link in the first place.
        //
        // `signInUrl()` is deliberately NOT in this selector any more: since
        // the login card arrived, sign-in renders as a real MUI `Button` in
        // Discord's blurple, and two competing rules for one control is how a
        // button ends up yellow on one state and blurple on the next.
        '& a[href*="action=issue"]': {
          ...theme.typography.body2,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 44,
          // px strings, NOT bare numbers: inside `sx`, MUI runs
          // spacing-aware properties (`padding*`, `margin*`, `gap`) through
          // `theme.spacing`, so `paddingInline: 20` is 160px, not 20 — which
          // is what turned this button into a full-width yellow bar.
          paddingInline: '20px',
          borderRadius: `${radius.pill}px`,
          backgroundColor: color.surface.primary,
          color: color.black,
          textDecoration: 'none',
          // The panel is a column flex container, so without this the button
          // stretches to the full 720 px measure — a full-width yellow bar
          // that reads as a banner, not a control.
          alignSelf: 'flex-start',
          '&:hover': { backgroundColor: color.primary[300] },
          // The `+` badge the empty-key card puts inside this link. The rule
          // had no icon to space before, so it set no gap at all.
          gap: 1.5,
          // The empty-key card's bar, full width (Adam, 2026-08-26).
          // `stretch` rather than `width: 100%`: the panel is a column flex
          // container, so the cross-axis is what decides this, and a
          // percentage width would still be pinned left by `alignSelf` above.
          //
          // The rule above pins every OTHER issue link to `flex-start`, on the
          // reasoning that a stretched yellow row reads as a banner rather
          // than a control. That still holds where the link sits among other
          // things. Here it is the only thing in the card, so there is nothing
          // for it to be mistaken for.
          '&[data-variant="cta"]': {
            alignSelf: 'stretch',
            justifyContent: 'center',
            // Taller than the inline form (44) — measured off the frame, where
            // this bar is the card's whole body and carries the same weight as
            // the key's ringed box on the card it replaces.
            minHeight: 56,
          },
        },
      }}
    >
      {children}
    </Box>
  );
}
