# sorobanscan-api-portal

The hub of Soroban Scan's APIs, built for `https://sorobanscan.com/api/`: one page that lists
the Prices API, the x402 Facilitator and the Soroban Scan API that is coming, and sends each
reader to the product's own page. Later this app also holds the shared sign-in and dashboard
(`/api/login`, `/api/dashboard`); for now it is the hub alone, with no sign-in, no backend call
and no analytics.

The page is not on production. The hub at `sorobanscan.com/api/` today is still the explorer's
own.

React 19, Vite 8, react-router 8, TypeScript, Vitest. The design and the reasons behind each
choice are in [the spec](docs/superpowers/specs/2026-11-17-api-hub-design.md); the build steps
in [the plan](docs/superpowers/plans/2026-11-17-api-hub-plan.md).

## Running it

Node 22.13 or later, and pnpm 11 (Corepack takes the version from `package.json`).

```sh
pnpm install
pnpm dev        # the page under /api/ at the address it prints
pnpm test       # the page's tests, and builds that check every file it asks for
pnpm typecheck
pnpm build      # the bundle in dist/
pnpm preview    # dist/ served locally, under the same prefix
```

## The prefix: `VITE_BASE_PATH`

The bundle is built for one prefix, `/api/` unless `VITE_BASE_PATH` says another
(`VITE_BASE_PATH=/api/next/ pnpm build`). Vite's `base` and the router's `basename` both follow
it, so every file the page asks for is under the prefix. The value must start and end with `/`;
anything else stops the build with a message naming the setting. A build for any prefix but
`/api/` gets `<meta name="robots" content="noindex">`.

The page loads nothing from another host: its three fonts (Space Grotesk, Manrope, JetBrains
Mono) are in the bundle, and the build's tests check that the page's script and stylesheet come
from under the prefix and that no stylesheet names another host.

## Putting it on production

Nothing in this repo uploads it. The bundle, built for its address, goes by hand to the bucket
the product pages are served from, and the explorer's CloudFront distribution needs behaviours
for it: behind Basic Auth at an address of its own until it opens, or at `/api/` once it
replaces the old hub. The spec's section "Putting it on production" lists what each of those
takes.

## The text

Every word on the page is the design's, placeholders included (`[ACCESS MODEL: …]`, `[LEDGER]`,
`[TX_HASH]`), and nothing in it was corrected. Some of it is not true yet, such as the
`api.sorobanscan.com/…` endpoints and "2 APIs live": the spec's section "Known untruths in the
design" lists each one, to settle before the page opens.
