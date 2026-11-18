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

React 19, Vite 8, react-router 8, TypeScript, Vitest; the Prices portal and the sign-in page and
dashboard also MUI 7 with emotion.
The hub's design and the reasons behind each choice are in
[its spec](docs/superpowers/specs/2026-11-17-api-hub-design.md); the build steps in
[its plan](docs/superpowers/plans/2026-11-17-api-hub-plan.md). The Prices portal's move is in
the shared sign-in spec and
[its plan](docs/superpowers/plans/2026-11-17-prices-portal-move-plan.md).

## Running it

Node 22.13 or later, and pnpm 11 (Corepack takes the version from `package.json`).

```sh
pnpm install
pnpm dev        # the hub at /api/, the Prices portal at /api/prices-api/, the backend at /api/hub/
pnpm test       # the page's and the backend's tests, and builds that check the page's files
pnpm typecheck  # the hub, the Prices portal with its own options, then the backend
pnpm build      # the bundle in dist/
pnpm preview    # dist/ served locally, under the same prefix, with dev's proxy and backend
```

Both `pnpm dev` and `pnpm preview` send the Prices backend's paths to Prices' production API
(see "The Prices portal" below) and serve the hub's own backend themselves (see "The hub's
backend"), so the browser sees one origin.

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
own. The build's tests check that every file the page's HTML asks for, the boot script and the
favicons, is under the prefix (each tree's script and CSS come through the boot chunk's preload
map, from the same `assets/`), and that its HTML and stylesheets name no host but those two.
The hub shows the SorobanScan favicons, the Prices portal's.

## The Prices portal

Its code is in `src/prices/`, copied from stellar-prices-api at `7d9e9e70`: `web/portal/src/X`
is `src/prices/X`, with Prices' names, code style and comments. `src/boot.js` picks the tree by
the address: `/api/prices-api` and everything under it boots the Prices portal, `/api/login`,
`/api/dashboard` and everything under the dashboard the sign-in page and dashboard
(`src/account/`, below), every other address the hub. Each tree brings its own styles, fonts and
router, so none's reach another. `tsconfig.prices.json` checks `src/prices` with Prices' own
compiler options, and `src/account` with them, since it is built from Prices' theme and
components; the hub's `tsconfig.json` leaves both out, and no hub TypeScript file imports from
either.

`VITE_PORTAL_API_ORIGIN` is its backend's origin, a build setting. Production's is
`https://prices-api.sorobanscan.com`:

```sh
VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com pnpm build
```

Without it every backend URL is relative (`/api/config`, `/api/auth/login`), which only the dev
server's proxy answers.

`pnpm dev` and `pnpm preview` send the backend's paths (`/api/auth`, `/api/key`, `/api/usage`,
`/api/config`, `/api/api-docs-json`, `/v1`, `/health`, `/api-docs-json`) to Prices' production
API, `https://prices-api.sorobanscan.com`, so the browser sees one origin and the Prices portal
shows what production shows. "Get API Key" opens Discord, but the round trip ends on production
and does not complete here.

`DEV_API_PROXY_TARGET` points them at another backend instead. Put it in `.env.local`, which
both commands read and git ignores, or in the environment of each command:

```sh
echo "DEV_API_PROXY_TARGET=http://localhost:8080" >> .env.local
```

Not in `.env.development`: `pnpm preview` runs in mode `production` and never reads it, so it
would go to production with no sign of the switch.

`DEV_API_KEY`, set the same way, goes on `/v1` alone as `x-api-key`. Neither setting starts with
`VITE_`, so neither reaches the bundle.

Signing in locally needs Prices' backend run locally, as its own README says
(stellar-prices-api `packages/prices-api/README.md`, "Running portal sign-in locally": `cargo run
--bin serve`, on port 8080), with `DEV_API_PROXY_TARGET=http://localhost:8080`. Its
`redirect_uri` and the Discord registration must name this dev server,
`http://localhost:5173/api/auth/callback`, not Prices' port 4200.

## The hub's backend

The hub's own sign-in, the backend for the hub's pages (BFF), is in `bff/`: a Hono app that signs
a member of Stellar Developers who has cleared Membership Screening in with Discord and keeps the
session in an `HttpOnly` cookie, under `/api/hub/` (`auth/login`, `auth/callback`, `me`,
`auth/logout`). Its design is the shared sign-in spec's "The session"; the build steps are in
[its plan](docs/superpowers/plans/2026-11-17-hub-sign-in-local-plan.md). `pnpm dev` and
`pnpm preview` serve it themselves, through a Vite plugin (`bff/src/vite-plugin.ts`), on the
page's own origin; `bff/test` runs in Node.

Its settings go in `.env.local`, which both commands read and git ignores. Not in
`.env.development.local`: `pnpm preview` runs in mode `production` and never reads that one.

```sh
DISCORD_CLIENT_ID=…       # the hub's Discord application
DISCORD_CLIENT_SECRET=…   # and its secret
HUB_SESSION_SECRET=…      # signs the session cookie: make one with `openssl rand -base64 32`
```

Optional: `DISCORD_GUILD_ID`, the Discord server an account must be a member of (Stellar
Developers, `897514728459468821`, by default), and `HUB_PUBLIC_ORIGIN`, the page's origin, which
Discord's callback is under (`http://localhost:<port>` by default, with the port the server got).
That default is the dev and preview servers' own: the backend itself (`readSettings`) requires
`HUB_PUBLIC_ORIGIN`, so whatever else runs it must name its origin. None of them starts with
`VITE_`, so none reaches the bundle.

The Discord application must list the callback among its redirects:
`http://localhost:5173/api/hub/auth/callback` for `pnpm dev`, and
`http://localhost:4173/api/hub/auth/callback` to sign in on `pnpm preview` too.

Without the three settings `/api/hub/*` answers 503 `{"error":"sign_in_not_configured"}` and
everything else runs as before. With only one or two of them it answers the same, and the server
warns at start, naming the ones missing. A malformed `HUB_SESSION_SECRET`, `DISCORD_GUILD_ID` or
`HUB_PUBLIC_ORIGIN`, or one of the Prices tab's settings below, stops the server from starting,
naming the setting, whether or not the others are set; when the server restarts itself (after a
change to the config or an `.env` file), Vite logs "server restart failed" and keeps the old
server running.

Only the dev and preview servers run it: deploying it (in AWS, beside the explorer's CloudFront,
the cutover's step 1) is a later plan.

### The token to Prices

For the Prices tab the backend calls Prices' own backend server to server, on Prices' hub
contract, with a token of its own on each call: `v1.<payload>.<mac>`, the claims' JSON in
base64url and their HMAC-SHA256 under a secret the hub and Prices share, good for 60 seconds and
for one act (`read`, `reveal`, `revoke` or `issue`). The format and the test vector both sides pin
are the shared sign-in spec's decision 15 (`bff/src/token.ts`, `bff/test/token.test.ts`).

The page calls only the hub's backend (`bff/src/products/prices.ts`):
`GET /api/hub/prices/account`, `POST /api/hub/prices/key/reveal` and
`POST /api/hub/prices/key/revoke`, each one call to Prices' `account`, `key/reveal` or
`key/revoke` with a fresh token. Prices' answer
is passed on as it is; its error codes as `{"error": "<code>"}` under its status (with its
`details` for `key_revoked` only), but for a 404 `no_key` or `key_revoked`, which is 409, since the
CDN turns a 404 into another page, and a 401 or 403 (Prices refusing the hub's token), which is
502; any other 404 is 502 `prices_unavailable`. Without a session they answer 401 `not_signed_in`,
for a product not in `HUB_PRODUCTS` 400 `unknown_product`, and while the secret can't be read 503
`product_not_configured`. A call gives up 20 seconds after it started, the secret's read included,
and is tried once more on a 503, within those 20 seconds; a 429 without Prices' envelope (API
Gateway's throttle) is 503 `prices_busy`, and any other answer that isn't Prices' JSON 502
`prices_unavailable`. Each key event is logged with `discord:<id>` and the token's `jti`, which
Prices logs too; never a token, a key or a body.

"Get API Key" is a form `POST` to `/api/hub/auth/issue` with `product=prices`, from the page's
own origin and with a session; no key is issued at sign-in. It sends the browser through Discord
again, with `prompt=none`, so an account that consented before comes straight back; `issue` and
the product are signed into both halves of that round trip, and the account into the browser's.
At the callback Discord's account must be the session's (else `account_mismatch`, and Prices is
not asked), a member of Stellar Developers who has cleared screening, and at least
`MIN_ACCOUNT_AGE_MINUTES` old, read from its id; then Prices' `key/issue` is called with a token
for `issue`. The browser lands on `/api/dashboard/prices?issue=<outcome>`: Prices' `issued`,
`has_key`, `capped`, `too_young` or `failed`, or the hub's `not_member`, `pending_rules`,
`unknown`, `too_young`, `account_mismatch`, `cancelled` or `failed` (Prices out of reach too).
The callback has 25 seconds, under CloudFront's 30-second wait for an origin: Discord's three
steps take at most 4 seconds each, and Prices' `key/issue` gets what they left, never more than
its own 20. Each refusal is logged as `issue_refused <outcome>` with the account that asked
(`discord:<id>`, from the browser's half); a `key/issue` that gave no outcome is logged once, as
`prices_call_failed issue`, with the account, the `jti` and why.

The secret is in AWS Secrets Manager, in `eu-central-1`, as JSON: `{"current": "<base64 of 32
bytes>"}`, with `"previous"` beside it while it is being changed. The hub signs with `current`;
Prices accepts either. `HUB_PRICES_TOKEN_SECRET` is its name, `sorobanscan-hub/production/prices-token`
unless set. The name, not the value: the value is never in a setting, a file or git, and a value
given here by mistake (base64 of 32 bytes or more) stops the server without printing it. The
backend reads the secret through the AWS SDK's default credentials, keeps it 5 minutes and never
logs it. A read that fails (no credentials, no access, a malformed secret, no answer in 15
seconds) is logged once as `product_secret_unavailable`, with the reason, and is tried again after
10 seconds.

Locally the credentials are yours: a profile that may read the secret
(`secretsmanager:GetSecretValue`), signed in to first if it is an SSO one, named in the command's
environment:

```sh
aws sso login --profile <profile>
AWS_PROFILE=<profile> pnpm dev
```

`AWS_PROFILE` goes in the environment, not in `.env.local`: the backend's own settings are read
from there, but the AWS SDK reads only the process's environment.

The secret is created once, by akot, with a value no one sees:

```sh
aws secretsmanager create-secret --name sorobanscan-hub/production/prices-token --region eu-central-1 --secret-string "{\"current\":\"$(openssl rand -base64 32)\"}"
```

The Prices tab's other settings, optional, in `.env.local` like the sign-in's:

- `PRICES_HUB_API`: Prices' hub contract, `https://prices-api.sorobanscan.com/api/hub/v1` unless
  set. HTTPS, or plain HTTP to this machine only; no trailing slash.
- `HUB_PRODUCTS`: the products whose routes answer, a comma list, `prices` unless set. A name this
  backend has no routes for stops the server.
- `MIN_ACCOUNT_AGE_MINUTES`: how old a Discord account must be, in minutes, to be issued a key; 5
  unless set.

## The sign-in page and the dashboard

`/api/login` and `/api/dashboard` (`src/account/`) are the hub's one sign-in and one dashboard,
drawn as the Prices portal's: its theme, login card and dashboard panels. The hub's top bar links
to them. `/login`'s button goes to the backend's `auth/login`, which comes back to `/dashboard`,
or to `/login?signin=<reason>` with the refusal in Prices' words. Without the backend's settings
`/login` says sign-in is not configured. The dashboard has a tab per API, `/api/dashboard/<api>`;
no tab shows a key or usage yet.

`VITE_PRODUCTS`, a build setting, is the comma list of APIs whose tab is open (`prices` unless it
names others, `prices,x402` once x402 opens); the other tabs show "Coming soon" and don't open.

## Putting it on production

Nothing in this repo uploads it, and there is no preview address (the shared sign-in spec's
decision 10): the hub and the Prices portal go up together at their real addresses, `/api/` and
`/api/prices-api/`, at the switch, step 3 of the spec's cutover, and are tried there. The
production build must name the Prices backend, or the Prices pages reach none:
`VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com pnpm build`.

The bundle goes by hand to the bucket the product pages are served from, under `api/index.html`
and `api/assets/` and never under `api/prices-api/`, so the old Prices portal's files stay where
they are. The explorer's CloudFront then serves `/api`, `/api/`, `/api/assets/*`, `/api/login`,
`/api/dashboard*`, `/api/privacy-policy` and `/api/prices-api/*` from it; reverting that change
brings the old hub and the old Prices portal back at once. The cutover lists the steps before
and after it; the hub spec's section "Putting it on production" says how the upload is done
(two `aws s3 sync` runs and an invalidation).

## The text

Every word on the hub's page is the design's, placeholders included (`[ACCESS MODEL: …]`,
`[LEDGER]`, `[TX_HASH]`), and nothing in it was corrected. Some of it is not true yet, such as
the `api.sorobanscan.com/…` endpoints and "2 APIs live": the hub spec's section "Known untruths
in the design" lists each one, to settle before the page opens. The Prices pages read as they
do in stellar-prices-api.
