# sorobanscan-api-portal

The hub of Soroban Scan's APIs, built for `https://sorobanscan.com/api/`: one page that lists
the Prices API, the x402 Facilitator and the Soroban Scan API that is coming, and sends each
reader to the product's own page. The Prices API's portal is here too, at `/api/prices-api/`,
moved in from stellar-prices-api with its own Discord sign-in and dashboard. Later this app also
holds the shared sign-in and dashboard (`/api/login`, `/api/dashboard`), which replace the Prices
portal's own.

Neither is on production from this repo. The hub at `sorobanscan.com/api/` today is still the
explorer's own, and the Prices portal at `sorobanscan.com/api/prices-api/` is still the copy in
stellar-prices-api's `web/portal`, deployed from there. That copy stays the deployed one until
the switch, step 3 of the cutover in
[the shared sign-in spec](docs/superpowers/specs/2026-11-17-shared-sign-in-design.md).

React 19, Vite 8, react-router 8, TypeScript, Vitest; the Prices portal also MUI 7 with emotion.
The hub's design and the reasons behind each choice are in
[its spec](docs/superpowers/specs/2026-11-17-api-hub-design.md); the build steps in
[its plan](docs/superpowers/plans/2026-11-17-api-hub-plan.md). The Prices portal's move is in
the shared sign-in spec and
[its plan](docs/superpowers/plans/2026-11-17-prices-portal-move-plan.md).

## Running it

Node 22.13 or later, and pnpm 11 (Corepack takes the version from `package.json`).

```sh
pnpm install
pnpm dev        # the hub under /api/, the Prices portal under /api/prices-api/
pnpm test       # both trees' tests, and builds that check every file the page asks for
pnpm typecheck  # the hub, then the Prices portal with its own options
pnpm build      # the bundle in dist/
pnpm preview    # dist/ served locally, under the same prefix
```

## The prefix: `VITE_BASE_PATH`

The bundle is built for one prefix, `/api/` unless `VITE_BASE_PATH` says another
(`VITE_BASE_PATH=/api/next/ pnpm build`, or the line `VITE_BASE_PATH=/api/next/` in a `.env`
file, which the environment overrides). Vite's `base` and the router's `basename` both follow
it, so every file the page asks for is under the prefix, and the Prices portal is at
`prices-api/` under it. The value must start and end with `/`, and start with only one
(`//api/next/` would name another host); anything else stops the build with a message naming the
setting. A build for any prefix but `/api/` gets `<meta name="robots" content="noindex">`.

The Prices pages are `noindex` at every prefix, but only from JavaScript: they render the tag
themselves and React puts it in the head, while the HTML the server sends is the hub's.
Crawlers don't reliably run that, so at the switch the explorer's CloudFront adds the header
`X-Robots-Tag: noindex` to `/api/prices-api` and `/api/prices-api/*` (cutover step 3).

Besides the Prices backend (below), the page loads files from two other hosts, both analytics,
on every page of the app as the Prices portal does: Google Tag Manager's container
`GTM-TBF2GP5S` (`www.googletagmanager.com`) and HubSpot's consent banner `8102665`
(`js.hs-scripts.com`), with Prices' consent-mode defaults set before either loads. Its fonts are
in the bundle: the hub's three (Space Grotesk, Manrope, JetBrains Mono) and the Prices portal's
own. The build's tests check that the page's script and stylesheet come from under the prefix,
and that its HTML and stylesheets name no host but those two. The hub shows the SorobanScan
favicons, the Prices portal's.

## The Prices portal

Its code is in `src/prices/`, copied from stellar-prices-api at `7d9e9e70`: `web/portal/src/X`
is `src/prices/X`, with Prices' names, code style and comments. `src/boot.js` picks the tree by
the address: `/api/prices-api` and everything under it boots the Prices portal, every other
address the hub. Each tree brings its own styles, fonts and router, so neither's reach the other.
`tsconfig.prices.json` checks `src/prices` with Prices' own compiler options; the hub's
`tsconfig.json` leaves it out, and no hub file imports from it.

`VITE_PORTAL_API_ORIGIN` is its backend's origin, a build setting. Production's is
`https://prices-api.sorobanscan.com`:

```sh
VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com pnpm build
```

Without it every backend URL is relative (`/api/config`, `/api/auth/login`), which only the dev
server's proxy answers.

`DEV_API_PROXY_TARGET` is where `pnpm dev` and `pnpm preview` send the backend's paths
(`/api/auth`, `/api/key`, `/api/usage`, `/api/config`, `/api/api-docs-json`, `/v1`, `/health`,
`/api-docs-json`), so the browser sees one origin. It goes in the environment or in
`.env.development`, which git ignores:

```sh
DEV_API_PROXY_TARGET=https://prices-api.sorobanscan.com pnpm dev
```

`DEV_API_KEY`, when set, goes on `/v1` alone as `x-api-key`. Neither setting starts with
`VITE_`, so neither reaches the bundle. Without a target there is no proxy, and the Prices pages
that call the backend say they could not reach it.

Signing in locally needs Prices' backend run locally, as its own README says
(stellar-prices-api `packages/prices-api/README.md`, "Running portal sign-in locally"), with
`DEV_API_PROXY_TARGET=http://localhost:8080`. Its `redirect_uri` and the Discord registration
must name this dev server, `http://localhost:5173/api/auth/callback`, not Prices' port 4200.
Against production the sign-in goes to Discord and comes back to production, never to localhost.

## Putting it on production

Nothing in this repo uploads it. The bundle, built for its address, goes by hand to the bucket
the product pages are served from, and the explorer's CloudFront distribution needs behaviours
for it: behind Basic Auth at an address of its own until it opens, or at `/api/` once it
replaces the old hub. The hub spec's section "Putting it on production" lists what each of those
takes. The Prices portal goes with the hub at the switch; the shared sign-in spec's cutover says
in what order.

## The text

Every word on the hub's page is the design's, placeholders included (`[ACCESS MODEL: …]`,
`[LEDGER]`, `[TX_HASH]`), and nothing in it was corrected. Some of it is not true yet, such as
the `api.sorobanscan.com/…` endpoints and "2 APIs live": the hub spec's section "Known untruths
in the design" lists each one, to settle before the page opens. The Prices pages read as they
do in stellar-prices-api.
