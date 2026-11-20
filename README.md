# sorobanscan-api-portal

The hub of Soroban Scan's APIs, built for `https://sorobanscan.com/api/`: one page that lists
the Prices API, the x402 Facilitator and the Soroban Scan API that is coming, and sends each
reader to the product's own page. The Prices API's portal is here too, at `/api/prices-api/`,
moved in from stellar-prices-api with its own Discord sign-in and dashboard. Later this app also
holds the shared sign-in and dashboard (`/api/login`, `/api/dashboard`), which replace the Prices
portal's own.

## On production

Once the start is done (the deployment is in [the runbook](docs/runbook.md)), the explorer's
CloudFront distribution serves `https://sorobanscan.com/api/` from this repo: the pages from the
bucket `production-soroban-explorer-api-spa`, under `api/`, and `/api/hub/*` from the backend, a
Lambda behind a function URL that only the distribution reaches (the runbook has the order, the
checks, the way back and how each secret is changed). The Prices portal's old files stay in the
bucket, so the way back shows it working. The x402 Facilitator's page, `/api/x402-facilitator/`,
is not served: the address answers `302` to `/api/`. Until the start the hub at
`sorobanscan.com/api/` is the explorer's own, and the Prices portal at `/api/prices-api/` is the
copy in stellar-prices-api's `web/portal`.

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
VITE_PRODUCTS=prices,x402 pnpm build   # the bundle in dist/, as production's has it
pnpm preview    # dist/ served locally, under the same prefix, with dev's proxy and backend
```

Both `pnpm dev` and `pnpm preview` send the Prices backend's paths to Prices' production API
(see "The Prices portal" below) and serve the hub's own backend themselves (see "The hub's
backend"), so the browser sees one origin.

## The prefix: `VITE_BASE_PATH`

The bundle is built for one prefix, `/api/` unless `VITE_BASE_PATH` says another
(`VITE_PRODUCTS=prices,x402 VITE_BASE_PATH=/api/next/ pnpm build`, or the line `VITE_BASE_PATH=/api/next/` in a `.env`
file, which the environment overrides). Vite's `base` and the router's `basename` both follow
it, so every file the page asks for is under the prefix, and the Prices portal is at
`prices-api/` under it. The hub's links to the bundle's own pages follow it too (`src/links.ts`:
the Prices portal, the sign-in, the quick starts and the reference); its link to the
explorer doesn't, since that is another app at its own address. The hub links to no other app's
page under `/api/`.
The value must start and end with `/`, and start with only one
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
the address: `/api/prices-api` and everything under it boots the Prices portal; `/api/login`,
`/api/privacy-policy`, `/api/dashboard`, `/api/quick-start`, `/api/docs` and everything under each
of them the account pages: the sign-in, the privacy policy, the dashboard and the two documentation
pages (`src/account/`, below); every other address the hub. Each tree brings its own styles, fonts and
router, so none's reach another. `tsconfig.prices.json` checks `src/prices` with Prices' own
compiler options, and `src/account` with them, since it is built from Prices' theme and
components; the hub's `tsconfig.json` leaves both out, and no hub TypeScript file imports from
either.

`VITE_PORTAL_API_ORIGIN` is its backend's origin, a build setting. Production's is
`https://prices-api.sorobanscan.com`:

```sh
VITE_PRODUCTS=prices,x402 VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com pnpm build
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
`HUB_PUBLIC_ORIGIN`, or a malformed setting of either product's below (`HUB_PRODUCTS`, the secrets'
names, the APIs' addresses, `MIN_ACCOUNT_AGE_MINUTES`; x402's too, with x402 off), stops the
server from starting, naming the setting, whether or not the others are set; when the server
restarts itself (after a change to the config or an `.env` file), Vite logs "server restart
failed" and keeps the old server running.

The x402 tab is opt-in: `HUB_PRODUCTS` is `prices` unless set, and `HUB_PRODUCTS=prices,x402` turns
on x402's routes (below). Without it the three routes with a session (`account`, `key/reveal` and
`key/revoke`) answer 400 `unknown_product`, without a session they answer 401 `not_signed_in`, and
any other path under `/api/hub/x402/` 400 `unknown_route`.

On production it is a Lambda (`bff/src/lambda.ts`, Node 22) behind a function URL, made by the CDK
app in `infra/` (`pnpm infra:synth`, `infra:diff`, `infra:deploy`, each with
`-c discordClientId=<id>`). Its plain settings are the function's environment: `HUB_PUBLIC_ORIGIN`
(`https://sorobanscan.com`), `HUB_PRODUCTS` (`prices,x402`) and `DISCORD_CLIENT_ID`. Three more
name secrets in Secrets Manager, which an instance reads when it starts and never from the
environment: `HUB_DISCORD_SECRET_NAME` (Discord's client secret), `HUB_SESSION_SECRET_NAME` (the
session's) and `HUB_ORIGIN_SECRET_NAME` (the header CloudFront sends, check 1 below); the products'
token secrets are read by the names in their own settings. While an instance can't read one, every
request is 503 `sign_in_not_configured` and the next read waits 10 seconds. The stack reserves 20
concurrent executions, which bounds the limit below, kept in each instance's memory.

Before any route, after its `no-store` headers, the backend checks a request in this order:

1. **Only through CloudFront.** With a secret in its settings (`originSecret`, which the Lambda's
   entry gives it and `readSettings` never does), a request must carry the secret's `current` or
   `previous` value in `X-Hub-Origin-Secret`, a header CloudFront adds; each is compared in
   constant time. Anything else is 400 `{"error":"not_through_the_site"}`, and is not counted
   below. `pnpm dev` and `pnpm preview` have no such secret and make no such check.
2. **A limit by client.** The client is the address in `X-Hub-Viewer-Ip`, which CloudFront's
   function writes from the viewer's, and which the limit trusts only because of 1. An IPv6
   address counts by its /56; a missing or malformed one, as every request on the dev server, is
   one client with every other such request. 30 requests a minute to the three that call
   Discord (`GET auth/login`, `GET auth/callback`, `POST auth/issue`) and 120 to every other
   route, `auth/logout` among them, counted apart, so the dashboard keeps working for people
   behind one address who have spent the sign-in's, and kept in each instance's memory. `GET me`
   isn't counted: it reads the cookie and calls nobody, and the sign-in page asks it every 1.5 s
   while a sign-in window is open, so counting it would spend the dashboard's 120 and read a
   sign-in that worked as failed. Over the limit, the three, which a browser opens as pages, send
   the browser to `/api/login?signin=busy`, where the sign-in page, or "Get API Key"'s tab when
   its window lands there, says "Too many sign-in attempts from your network. Try again in a
   minute."; anything else is 429 `{"error":"rate_limited"}` with `Retry-After`.
3. **The page's `Origin`** on every `POST`: 400 `{"error":"bad_origin"}` otherwise.

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
own origin and with a session; no key is issued at sign-in. Its answer is a page, not JSON: without
a session (it ended since the dashboard was drawn) it sends the browser to `/api/login`, and for a
product not in `HUB_PRODUCTS` to `/api/dashboard?issue=failed`, logged as `issue_refused failed`;
a `POST` from another origin is still 400 `bad_origin`. It sends the browser through Discord
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
bytes>"}`. The hub signs with `current` and ignores a `"previous"` beside it; Prices accepts
either. `HUB_PRICES_TOKEN_SECRET` is its name, `sorobanscan-hub/production/prices-token`
unless set. The name, not the value: the value is never in a setting, a file or git, and a value
given here by mistake (base64 of 32 bytes or more) stops the server without printing it. The
backend reads the secret through the AWS SDK's default credentials, keeps it 5 minutes and never
logs it. A read that fails (no credentials, no access, a malformed secret, no answer in 15
seconds) is logged once as `product_secret_unavailable`, with the reason, and is tried again after
10 seconds.

Changing the value is Prices' procedure, with its commands: "Changing the value without a gap" in
`docs/runbooks/hub-contract.md` of `rumblefishdev/stellar-prices-api`. Prices keeps the value it
read for an execution environment's life, the hub for 5 minutes, so every Prices environment must
accept the new value before the hub signs with it. In short, four steps, each safe to stop after:
(1) put the new value as `previous`; (2) recycle Prices' api-handler, so every environment reads
both; (3) swap them, so the new value is `current` and the old one `previous`, and the hub signs
with the new one within 5 minutes; (4) after at least 10 minutes, drop the old one and recycle
again. Writing the new value as `current` in one step, without (1) and (2), leaves the Prices
environments that still hold the old value refusing every hub call until they are recycled: the
tab gets 502 `invalid_token`.

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

### The token to x402

The x402 tab (turned on by `HUB_PRODUCTS=prices,x402`) is the same contract, with `product: x402`
in its calls (`bff/src/products/client.ts`): `GET /api/hub/x402/account`,
`POST /api/hub/x402/key/reveal`, `POST /api/hub/x402/key/revoke` and, from "Get API Key" with
`product=x402`, `key/issue`, answered and logged as Prices' are, under `x402_busy`,
`x402_unavailable` and the `x402_` log events. The browser lands on
`/api/dashboard/x402?issue=<outcome>`. A token for x402 is signed under x402's own audience and
context, so it is no good to Prices, nor Prices' to x402. Its settings, beside Prices':

- `HUB_X402_TOKEN_SECRET`: the secret's name in Secrets Manager,
  `sorobanscan-hub/production/x402-token` unless set; the name, not the value, as
  `HUB_PRICES_TOKEN_SECRET` is.
- `X402_HUB_API`: x402's hub contract, `https://x402-portal.sorobanscan.com/api/hub/v1` unless
  set; https with no trailing slash (http on this machine only), as `PRICES_HUB_API` is.

The secret is made as Prices' is, once, in `eu-central-1`:

```sh
aws secretsmanager create-secret --name sorobanscan-hub/production/x402-token \
  --region eu-central-1 --secret-string "{\"current\":\"$(openssl rand -base64 32)\"}"
```

x402's backend reads a copy of that value from a file on its own server, not from AWS. One
product's secret out of reach fails that product's calls alone (503 `product_not_configured`);
the others answer.

Changing the value is Prices' procedure, the same four steps, on
`sorobanscan-hub/production/x402-token`: (1) put the new value as `previous`; (2) make x402's
backend read both; (3) swap them, so the new value is `current` and the old one `previous`, and
the hub signs with the new one within 5 minutes; (4) after at least 10 minutes, drop the old one
and read again. Where Prices' steps recycle its Lambda, an admin copies the stored JSON to the
credential on x402's server and restarts its backend; those steps are in `docs/runbook.md`,
"The portal's backend", of `rumblefishdev/stellar-x402`. Writing the new value as `current` in one
step leaves x402's backend refusing every hub call until it has the new value: the tab gets 502
`invalid_token`.

### Trying the x402 tab locally

With the secret in place (above) and a profile that may read it:

```sh
VITE_PRODUCTS=prices,x402 HUB_PRODUCTS=prices,x402 AWS_PROFILE=stellar pnpm dev
```

The tab then works on production's x402 backend, `https://x402-portal.sorobanscan.com`. Revoking a
key there holds back a new one until the next calendar month (UTC), so try revoke last, or on a
second Discord account. While that backend is not deployed, the tab says x402 is unavailable.
The privacy policy page (`/api/privacy-policy`) shows x402's section, "x402 Facilitator API
keys" (`src/prices/privacy/privacy-policy-x402.md`), only in a build with `VITE_PRODUCTS` naming
`x402`; it is a draft, not reviewed by counsel.

## The sign-in page and the dashboard

`/api/login` and `/api/dashboard` (`src/account/`) are the hub's one sign-in and one dashboard,
drawn as the Prices portal's: its theme, login card and dashboard panels. The hub's top bar has
"Log in" for everybody, signed in or not (akot, 2026-11-19): the sign-in page sends whoever is
signed in on to the dashboard, so the landing page asks the backend nothing. Beside it the bar
has "Quick start" and "Docs", which are not the design's. `/login`'s button opens the backend's `auth/login` in a second window, as the Prices portal's
does (akot, 2026-11-19): the page says it is waiting, the window comes back to `/dashboard` or to
`/login?signin=<reason>`, hands that outcome to the page and shuts (`bridgeOAuthPopup` in
`src/boot.js`), and the page asks `/me` again before it goes to the dashboard, or shows the refusal
in Prices' words. Where the browser opens no second window the button is a plain link and the same
round trip runs in the tab. "Get API Key" on a dashboard tab runs in a second window too (akot, 2026-11-20; `src/account/useIssueWindow.ts`): the form's `POST` to `auth/issue` is sent to an empty window the page opens, the tab says it is waiting, and when the window lands on `/dashboard/<api>?issue=<outcome>` it hands that outcome to the tab and shuts, and the tab reads the account again. Where the browser opens no second window the form posts in the tab, which comes back with the outcome in its address. Without the backend's settings
`/login` says sign-in is not configured. When `/me` fails or doesn't answer in 10 seconds, both
pages say they could not check the sign-in, with "Try again", rather than treat the visitor as
signed out. The dashboard has a tab per API, `/api/dashboard/<api>`; an address naming a tab that
is shut or unknown is replaced by the first open one's.

The Prices tab (`src/account/prices/`) is the Prices portal's dashboard, drawn from its own parts
(`src/prices/landing/DashboardPanel.tsx`, `src/prices/dashboard/`) and fed by the backend's
`/api/hub/prices/*`: the key card (masked; Show key and Copy key ask `key/reveal`; Regenerate is
Prices' typed-phrase dialog over `key/revoke`), Monthly Usage and Rate Limit from `account`. With
no key, or a revoked one once its cap has passed, the card's "Get API Key" is a form `POST` to
`auth/issue`, sent to a second window (above); its outcome, the window's or the `?issue=` the tab
came back with, is said once in Prices' words, and `?issue=` is taken off the address. The backend's errors are said in words, with their code.

`VITE_PRODUCTS`, a build setting, is the comma list of APIs whose tab is open (`prices` unless it
names others, `prices,x402` once x402 opens); the other tabs show "Coming soon" and don't open.

## The quick start and the API reference

`/api/quick-start/<api>` and `/api/docs/<api>` (`src/account/docs/`) are every API's quick start
and API reference, one page of each kind with a tab per API (akot, 2026-11-19). They are open to
everybody and meant to be found, by readers, search engines and agents: nothing on them waits
for the session, they carry a title, a description and a canonical address of their own, and no
`noindex`. The bar is the dashboard's; for a visitor who isn't signed in it has "Log in" (to
`/api/login?from=<api>`) where the account and Sign out would be, and no Dashboard. An address
that names no API (`/api/quick-start`), a shut tab or an unknown one is replaced by the first
open tab's, keeping its `#part`.

The Prices portal's landing page is under the same bar (`PageBar` in
`src/prices/app/app.tsx`; the privacy policy is the hub's own page, `/api/privacy-policy`), in place of the portal's own bar with Features, Quick Start, FAQ, Sign
in and Get API Key, which only its old sign-in (`accountPages="own"`) still draws.

They were the Prices portal's own pages. `/api/prices-api/quick-start` and `/api/prices-api/docs`
now send the browser to `/api/quick-start/prices` and `/api/docs/prices`, and every link on the
Prices pages names those. Always the tab's address, never the bare one: the explorer answered
`/api/quick-start` and `/api/docs` with a `301` into the Prices portal, and a browser that kept
the redirect would be sent round a loop.

The Prices tab shows the Prices portal's quick start (`src/prices/quickstart/`) and its reference,
which renders the document Prices' API serves. x402's quick start is
`src/account/docs/X402QuickStart.tsx`, written from the facilitator's README and example seller in
`rumblefishdev/stellar-x402`. x402's reference renders `public/docs/x402/openapi.json`, served at
`/api/docs/x402/openapi.json`: a copy of `apps/facilitator/openapi.json` in that repo, to be
copied again whenever that file changes. The facilitator doesn't serve the document itself yet;
once it does, the page should read it from there, as Prices' does. Both x402 pages are behind
`VITE_PRODUCTS`, as its dashboard tab is.

The pages are drawn in the browser, so a reader that runs no scripts (most agents, some crawlers)
gets the hub's empty HTML at these addresses. What such a reader can use today is the two OpenAPI
documents, which are plain files: `/api/docs/x402/openapi.json` and
`/api/prices-api/openapi.json`. Drawing the pages at build time is not done.

## Putting it on production

By hand, from [the runbook](docs/runbook.md). The upload is `AWS_PROFILE=stellar pnpm run upload`
(`--dryrun` first): `scripts/upload-bundle.sh` builds with
`VITE_PRODUCTS=prices,x402 VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com pnpm build`
(a build without `VITE_PRODUCTS=prices,x402` sends every x402 link to the Prices tab) and copies
`dist/` to `s3://production-soroban-explorer-api-spa/api/` in two `aws s3 sync` calls, never
deleting anything, so the old Prices portal's files and earlier builds' assets stay.

## The text

Every word on the hub's page is the design's, placeholders included (`[ACCESS MODEL: …]`,
`[LEDGER]`, `[TX_HASH]`), and nothing in it was corrected. Some of it is not true yet, such as
the `api.sorobanscan.com/…` endpoints and "2 APIs live": the hub spec's section "Known untruths
in the design" lists each one, to settle before the page opens. The Prices pages read as they
do in stellar-prices-api.
