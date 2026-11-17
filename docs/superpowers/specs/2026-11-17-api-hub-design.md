# The API hub at sorobanscan.com/api, in a repo of its own

Design, 2026-11-17. Step 1 of 3 (decided by akot, 2026-11-17):

1. **The hub** after the new design (this document).
2. One sign-in at `/api/login` and one dashboard, with a Prices API tab.
3. The x402 tab (stellar-x402 task 0106 joins the shared sign-in).

Steps 2 and 3 get designs of their own. This one only leaves room for them.

## Intent

`https://sorobanscan.com/api` becomes the front page of every API Rumble Fish serves on Stellar:
Prices API, x402 Facilitator and, later, Soroban Scan API. Today it is one MUI card inside the
block explorer's app, listing Prices only. The new page is akot's design "APIs hub landing page"
(`https://claude.ai/artifact/VHb83AFRnmFYNfwGMTPyoj`, board `Main.dc.html`, 1440 px wide, one
breakpoint at 720 px).

The page lives in a new repo, because the sign-in and the dashboard of step 2 will be routes of
the same app: one top bar, one set of fonts, one deploy.

## Goals

- The designed page, with its text as the design has it, built for the address `/api/`.
- A new repo that step 2 can add `/login` and `/dashboard` to without restructuring.
- Step 1 ends with the page seen on the dev server and as a built bundle on a local static
  server. Nothing is uploaded and nothing changes in the explorer: the old hub stays public at
  `/api/` (akot, 2026-11-17: no preview address on production).
- Putting it on production later needs no code change in the page.

## Non-goals

- Sign-in, session, dashboard, any backend. The page is static.
- A "Log in" or "Dashboard" link: the design has none. Step 2 adds it.
- Changes to the Prices portal or the x402 page.
- Any upload, any change in `soroban-block-explorer`, any CI deploy. They come with putting the
  page on production, below.
- Correcting the design's claims (see "Known untruths").

## Anti-goals

- The old hub or the Prices portal breaking, or `/api/login` and `/api/dashboard` changing what
  they answer today (a `301` into the Prices portal). Step 2 decides their fate.
- The designed page reachable by the public before akot opens it.
- The page loading anything from another host (fonts, scripts, styles).

## Constraints (read in the repos, 2026-11-17)

- `sorobanscan.com` is the explorer's CloudFront distribution
  (`soroban-block-explorer`, `infra/src/lib/stacks/delivery-stack.ts`). Every `/api*` path is
  static or a redirect. Behaviours today: `/api/prices-api[/*]` and `/api/x402-facilitator[/*]`
  to the portals' bucket (`production-soroban-explorer-api-spa`, keys equal to the viewer path)
  through `api-spa-routing.ts`; `/api/` to the explorer's own bucket; `/api/*` to
  `api-hub-redirect.ts` (six old Prices routes get a `301`, the rest a `302` to `/api/`); bare
  `/api` falls to the default behaviour, the explorer's app.
- `api-spa-routing.ts` takes a prefix and an optional Basic Auth key in the KeyValueStore
  `<env>-soroban-explorer-basic-auth`. It answers `503` when the key is missing. The x402 page
  uses it with `auth-token-x402`.
- One viewer-request function per behaviour.
- The only CI role that may write the buckets trusts `soroban-block-explorer` alone. Other repos
  upload with an operator's credentials (`stellar-prices-api`, `infra/Makefile`,
  `sync-portal-explorer`; distribution `EA2TLS5SS5M87`).
- The explorer's local checkout was behind `origin/develop` when read. Re-read at its tip before
  writing the PR.

## Approaches

**A. The hub stays in the explorer's repo.** Replace `web/src/pages/ApiHubPage.tsx`, render it
outside the explorer's layout. One PR, existing CI, CloudFront untouched. But step 2's sign-in
and dashboard are a separate app in the new repo, so the bar, footer and fonts exist twice, and
the hub would likely move later.

**B. The hub is the first page of the new repo's app.** Picked by akot, 2026-11-17. The repo and
the CloudFront change are needed in step 2 anyway, and the hub is built once.

How it is shown while x402 is not open, also decided by akot (2026-11-17), from three choices:
x402 as "Coming soon" on a public hub; **the hub as designed behind Basic Auth, the old hub
public until then (picked)**; the hub as designed and public at once.

## Design

### The repo

- `rumblefishdev/sorobanscan-api-portal` (working name, akot's to change). Private or public:
  akot's call when it is created.
- One package: React 19, Vite 8, react-router 8 (as `apps/portal-web` has, `^8.5.1`), TypeScript, Vitest. The same stack as
  `stellar-x402`'s `apps/portal-web`, which is the model for the layout below. pnpm.
- `src/base-path.ts`: the prefix the bundle is built for, from the build setting
  `VITE_BASE_PATH`, default `/api/`. Vite's `base` and the router's `basename` both read it.
- `src/App.tsx`: the router. One route now (`/`, the hub); an unknown address shows the hub.
- `src/sections/`: one component per section of the design: `Chrome` (top bar, footer), `Hero`
  (with the `ls /api` terminal), `Products`, `WhichApi`, `HowTheyConnect`, `SorobanScanApi`,
  `BuiltBy`, `Faq`, `Closing`.
- `src/links.ts`: every address the page links to, in one place.
- Fonts: `@fontsource-variable/space-grotesk`, `@fontsource-variable/manrope`,
  `@fontsource-variable/jetbrains-mono`, in the bundle. No Google Fonts.
- Colours and measures from the design as CSS custom properties in `src/styles.css`. Dark only.
- No analytics, no consent banner in step 1 (the Prices portal has the explorer's GTM and
  HubSpot banner; whether the hub gets them is a question for akot before it opens).
- `<meta name="robots" content="noindex">` on a build for any base path but `/api/`.

### Text and links

- Text exactly as the design has it, placeholders included.
- Product links are relative to the site (`/api/prices-api/`, `/api/x402-facilitator/`), plain
  anchors, never router links: each is another app. The explorer link is `/`. The design writes
  them as absolute `https://sorobanscan.com/…`; relative keeps the page working on any host.
- The in-page anchors (`#products`, `#choose`, `#stack`, `#faq`, `#soroban-scan-api`) as designed.

### Tests

- `test/base-path.test.ts`: builds the page for `/api/` and for one other prefix, and checks
  every file the HTML asks for is under the prefix and no stylesheet or script names another
  host. After `stellar-x402`'s test of the same name.
- A render test per section is not needed; one test that the page renders every section's
  heading and every product link.
- Seen in a browser at 1440 px and at 390 px before it is called done.

### Putting it on production (not part of step 1; written so step 1 doesn't block it)

akot's decision stands that the designed hub is behind Basic Auth until x402 is open, with the
old hub public until then; when and at which address it first goes up is decided then. What it
will take, either way:

- **The bundle:** built for its address (`VITE_BASE_PATH`), uploaded by hand to the portals'
  bucket (`production-soroban-explorer-api-spa`, the key equal to the viewer path) with two
  `aws s3 sync` runs (`assets/*` immutable for a year, the rest `max-age=0`) and an invalidation,
  as the Prices portal's `sync-portal-explorer` does.
- **Behind Basic Auth:** a further instance of the explorer's `api-spa-routing` function with a
  KeyValueStore key of its own, as the x402 page has. At `/api/` itself that would close the old
  hub too, so a gated hub needs an address of its own until it opens.
- **Open at `/api/`:** an explorer PR sending `/api`, `/api/` and `/api/assets/*` to the portals'
  bucket (bare `/api` falls to the explorer's app today, and `/api/*` answers the bundle's
  `/api/assets/<hash>.js`, CSS and fonts with a `302` to `/api/`), and removing the explorer's
  `ApiHubPage.tsx` with its route. The bundle keeps Vite's `assets/` directory (Claude's call).
  The page's test can't catch a missing behaviour, so this is checked in a browser.

## Known untruths in the design

Left as designed while the page is behind Basic Auth; to settle with akot before it opens:

- "2 APIs live" and x402 "Live": the x402 page is behind Basic Auth, and pubnet is refused until
  stellar-x402's 0126, 0107 and 0090.
- `api.sorobanscan.com/prices` and `api.sorobanscan.com/x402`: Prices is at
  `prices-api.sorobanscan.com`, the facilitator at `x402-facilitator.sorobanscan.com`.
  `api.sorobanscan.com` is the explorer's API.
- `/discovery/search` and "our MCP server": the facilitator has `/discovery/resources` only.
- "four Soroban AMMs", "settles each call in about five seconds", "Ranked by volume of successful
  purchases": not checked against the products.
- "Do I need a separate key for each API? Yes … Each product page explains how to get yours":
  true today, but step 2 moves getting a key to the shared dashboard.
- Placeholders: `[ACCESS MODEL: …]`, `[LEDGER]`, `[TX_HASH]`.

## Calls made by Claude, for akot to check

- The repo's working name and the single-package layout.
- Relative product links instead of the design's absolute ones.
- No analytics or consent banner in step 1.
- `noindex` on any build whose base path is not `/api/`.
- The bundle's files stay in `assets/`, so opening the hub needs an `/api/assets/*` behaviour.

## Left to the builder

- How the design's inline styles become CSS (classes per section, as `apps/portal-web` does).
- The FAQ's open and close behaviour (the design shows `+`; a `<details>` element is enough).
- The build settings beyond `VITE_BASE_PATH`.
