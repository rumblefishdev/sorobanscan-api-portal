# One sign-in and one dashboard for every API

Design, 2026-11-17. Step 2 of the plan in `2026-11-17-api-hub-design.md` ("Step 1 of 3"), widened
by akot the same day: the Prices API portal stops having a sign-in of its own and moves, whole,
into this repo. x402 joins later (decision 7).

## Intent

A developer signs in once, at `https://sorobanscan.com/api/login`, with Discord, and lands on one
dashboard at `/api/dashboard` with a tab per product: Prices API, x402 Facilitator, and later ones.
In each tab they get, see and revoke that product's API key. Today each product has its own
Discord application, its own sign-in and its own session cookie on its own host, so a developer
signs in twice and the hub can't show one account.

## Decisions made with akot (2026-11-17)

1. **The products' backends stay; only the sign-in is shared.** Prices keeps its keys in API
   Gateway and its usage in its AWS account; x402 keeps its registry in PostgreSQL on its server.
   Each stops doing Discord sign-in and sessions and instead trusts the hub's sign-in.
2. **The shared sign-in runs in AWS**, under `sorobanscan.com/api/…`, in the account and region
   that already hold the explorer's CloudFront distribution and Prices (`eu-central-1`). Not in
   x402's backend, not in Prices' Lambda: the hub's sign-in must not fail with one product.
3. **Only members of Stellar Developers who have cleared Membership Screening can sign in.** An
   account that isn't a member, or is still `pending`, is not signed in and is told why, as the
   Prices portal does today.
4. **No key is issued on sign-in.** In each product's tab an account without a key sees
   "Get API Key"; only that button issues one. (Prices issues on first sign-in today; that ends.)
5. **The hub opens with Prices; x402 follows.** The hub and the shared sign-in go public together
   with the Prices tab. The x402 tab and the hub's x402 "Live" claims are off behind a build
   switch until x402 opens (stellar-x402 0126, 0107, 0090). This replaces step 1's "the designed
   hub stays behind Basic Auth until x402 opens".
6. **Backend for Frontend (BFF).** The browser talks to one backend, the hub's, on the hub's own
   origin. It holds the session in an `HttpOnly` cookie and calls each product's backend
   server-to-server with a short signed token that says who the user is. No token reaches the
   browser; the products' dashboard endpoints are no longer called by browsers.
7. **First one repo with the Prices portal moved in and working; x402 later.** The priority is
   this repo serving the Prices portal (its landing, docs and quick start at `/api/prices-api/…`,
   its dashboard as the Prices tab) on the shared sign-in. stellar-x402's 0106 is paused: its own
   sign-in is not deployed, and x402's move to this model is a design and plan of its own later.
8. **The hub's text stays as designed** when it opens, apart from what the x402 switch turns off
   (decision 5): the endpoints, placeholders and FAQ answers the step-1 design lists as untrue
   are akot's to change later.
9. **The hub gets the Prices portal's analytics**: the explorer's Google Tag Manager container and
   the HubSpot consent banner, as the Prices portal loads them, on every page of the app; the
   privacy policy covers them.
10. **No preview address.** akot, 2026-11-17: the app goes straight to its real addresses
    (`/api/`, `/api/prices-api/`) at the switch and is tried there; the way back is the
    CloudFront change reverted, with the old Prices portal untouched in the bucket (below).

## Approaches considered for decision 6

- **Tokens in the browser** (an identity provider and resource servers, the OIDC pattern): the
  page holds short per-product tokens and calls each product directly. Every product needs CORS
  for `Authorization`, a stolen token is usable until it expires, and the one-time permission to
  issue a key travels through the browser.
- **BFF (picked)**: the session stays server-side; products verify one signed token from one
  caller. Recommended for browser apps by the IETF draft "OAuth 2.0 for Browser-Based
  Applications". Costs one more hop per dashboard call, and the BFF being down takes the
  dashboard down, which the token approach shares in practice (no new tokens).
- **Checking the session at the edge** (CloudFront or API Gateway forwards identity): the edge is
  the explorer's distribution, which turns every 403/404 into `index.html` and allows one
  function per behaviour; the gate logic doesn't fit there.
- Ruled out: products asking the sign-in service about every request (coupling and latency with
  nothing gained over BFF); one cookie read by every backend (`Domain=sorobanscan.com` sends it to
  every subdomain, and one secret would sit in three systems); a hosted identity provider (Auth0,
  Clerk; Cognito needs OIDC and Discord gives OAuth2 only): the gates are ours to write anyway,
  and Discord IDs would go to another company.

## Goals

- One Discord application, one sign-in, one session, one dashboard, a tab per product.
- The gates are as strong as today's in both products: membership and screening at sign-in;
  membership, screening and account age read again, from a fresh Discord answer, when a key is
  issued (Prices ADR 0010 §8, stellar-x402 0106 decision 7).
- Each product keeps its own key rules (below) and its own data; the hub holds no key.
- Existing Prices keys keep working and show up in the Prices tab: both products already name an
  account by its Discord ID.
- Adding a product later is: a backend that implements the dashboard contract, a tab, a switch.

## Non-goals

- Moving where keys live or changing how products authorise their paid APIs.
- Accounts other than Discord; email; teams.
- A public API on the BFF for anyone but the hub's page.

## Anti-goals

- A key issued without a fresh Discord answer, or to an account the gates refuse.
- A token, a session secret or a key in browser storage, in a URL, or in a log.
- The Prices portal's users locked out at the cutover, or sent round a redirect loop.
- x402 shown as live before it opens.

## Constraints (read in the repos, 2026-11-17)

- `sorobanscan.com` is the explorer's CloudFront distribution (`soroban-block-explorer`,
  `infra/src/lib/stacks/delivery-stack.ts`). Every `/api*` path is static or a redirect today; no
  behaviour has a dynamic origin. The distribution turns every 403 and 404 into `index.html` with
  200, for every behaviour. Changes to it deploy from that repo only.
- `/api/login` and `/api/dashboard` are permanent `301`s to `/api/prices-api/login` and
  `/api/prices-api/dashboard` (explorer task 0670, decision 9); browsers that followed one keep it
  cached. `/api/hub/*` is unused (today a `302` to `/api/`).
- Prices' portal backend is inside its API Lambda (Rust, axum) behind API Gateway on
  `prices-api.sorobanscan.com`, routes under `/api/` (`auth`, `key`, `usage`, `config`), session
  cookie host-only on that host. Its keys are API Gateway keys named `discord-<id>-key`; revoke
  disables; a new key after a revoke waits for the next calendar month (UTC); usage comes from
  `GetUsage`. ADR 0010 records why each gate exists.
- x402's portal backend is `apps/portal` (Express) on the Hetzner server behind a Cloudflare
  Tunnel at `x402-portal.sorobanscan.com`; registry `api_keys` with a sealed, re-showable copy
  (`api_key_copies`); one active key per `discord:<id>`; revoke-then-issue is not capped
  (0106 decision 14, open). Its Discord sign-in code (`discord.ts`, `eligibility.ts`, `cookies.ts`,
  `tokens.ts`) is the closest model for the BFF's sign-in.
- The hub page is `sorobanscan-api-portal` (React 19, Vite 8, react-router 8), built for `/api/`.

## Design

### The pieces

```
browser ── sorobanscan.com/api/            hub page (static, S3)       /, /login, /dashboard/…
        └─ sorobanscan.com/api/hub/*  ──▶  BFF (Lambda, eu-central-1)  sign-in, session, proxy
                                             ├─▶ prices-api.sorobanscan.com  (Prices' backend)
                                             └─▶ x402-portal.sorobanscan.com (x402's backend)
```

- **The hub page** gains `/login`, `/dashboard` (and `/dashboard/prices`, later `/dashboard/x402`),
  `/privacy-policy`, and the Prices portal's pages under `/prices-api/` (below).
- **The BFF** is a Node 22 Lambda (TypeScript, like x402's portal backend, whose sign-in code it
  starts from) with a function URL as the origin of one new CloudFront behaviour, `/api/hub/*`,
  with caching off and cookies, query and headers forwarded. Its code and its infrastructure
  (CDK) live in `sorobanscan-api-portal`; the behaviour lives in the explorer's delivery stack.
- **The products' backends** each implement the dashboard contract below and verify the BFF's
  token. Their own sign-in, session and CORS for the portal go away after the cutover.

### The session

- Discord OAuth2 with exactly `identify` and `guilds.members.read`, a signed `state`, PKCE (S256)
  and a short-lived signed cookie holding the nonce and the verifier (both products' existing
  scheme). One new Discord application, registered by akot, with the callback
  `https://sorobanscan.com/api/hub/auth/callback` and a localhost one for development.
- At the callback with `action=signin`: the member answer must say member and not `pending`;
  otherwise no session, and the page says `not_member`, `pending_rules` or `unknown` (Discord
  failed; never reported as "not a member").
- The session is a signed cookie, `Path=/api/hub`, `HttpOnly`, `Secure`, `SameSite=Lax`, 24 hours,
  holding the Discord ID, the username and the expiry. No table. The Discord token is dropped.
- Every `POST` to the BFF must carry `Origin: https://sorobanscan.com`.

### Getting a key

1. "Get API Key" in a tab sends the browser to `/api/hub/auth/login?action=issue&product=prices`
   (or `x402`). The BFF starts a Discord round trip with `prompt=none`, so a consented account
   comes straight back.
2. At the callback the BFF reads, with that round trip's token: member, not `pending`, account at
   least 5 minutes old (from the snowflake). Refused: back to the tab with the reason.
3. Passed: the BFF calls the product's `issue` endpoint with a token whose `act` is `issue`, made
   then and good for 60 seconds. The product applies its own rules (one active key; Prices' month
   cap) and answers issued, already has a key, or refused with a reason.
4. The browser lands on the tab with the outcome in the address (`?issue=…`), read once and taken
   off, as both portals do today.

### The token the BFF gives products

- A JWT signed ES256 by an AWS KMS key (the private key never leaves KMS), `kid` in the header.
- Claims: `iss` `https://sorobanscan.com/api/hub`, `aud` the product (`prices`, `x402`), `sub`
  `discord:<id>`, `name` the username, `iat`, `exp` (60 s after `iat`), `jti`, and `act`: `read`
  for everything but issuing, `issue` only from step 3 above.
- Products verify signature, `iss`, `aud`, `exp` and `act` against a public key they are
  configured with (a list, by `kid`, so the key can be rotated); the BFF also publishes it at
  `/api/hub/jwks.json`. No product holds a secret of the hub's.
- The BFF→product call goes over HTTPS to the product's public hostname, on paths no browser page
  calls, with the token in `Authorization: Bearer`.

### The dashboard contract (each product's backend)

Under a prefix of the product's choosing (`/hub/v1/` suggested), with the token above:

| Call | `act` | Answer |
|---|---|---|
| `GET  /account` | read | the account's key state (`none`, `active`, `active_unshowable`, `revoked`), whether a new key can be had and when, and a product-specific `details` object for its tab |
| `POST /key/reveal` | read | the key, if the product can show it again |
| `POST /key/revoke` | read | revoked; holds from the product's next request |
| `POST /key/issue` | issue | `issued`, `has_key`, or `refused` with a reason the tab can show |

Prices' `details`: plan and tier, used / remaining / limit for the period, the re-issue date after
a revoke (today's `/api/usage`, `/api/key`, `/api/config`). x402's: none until 0107 brings quota.
The BFF exposes the same calls to the page as `/api/hub/<product>/…`, adding the session check and
nothing else.

### The Prices portal moves in

- The Prices portal (`stellar-prices-api`, `web/portal`, React 19 with MUI) is copied into this
  repo's app and served from the same bundle at `/api/prices-api/`, `/api/prices-api/docs` and
  `/api/prices-api/quick-start`, looking and reading as it does today. Its MUI and theme load
  only on its routes (a separate chunk), so the hub's own pages don't carry them.
- What changes in it: its "Sign in" and "Get API Key" go to the hub (`/api/login`,
  `/api/dashboard/prices`); its dashboard becomes the Prices tab, fed by the BFF instead of
  calling Prices' backend from the browser; its `/login`, `/dashboard` and `/privacy-policy`
  routes send the browser to the hub's (with `?from=prices`, see the cutover). Its API reference
  keeps reading the OpenAPI document from Prices' public API.
- Locally, `pnpm dev` serves it at `http://localhost:5173/api/prices-api/`.
- After the switch `web/portal` in `stellar-prices-api` is removed by a PR there; until then it
  stays as the fallback (cutover step 3 is reversible).

### The page

- `/api/login` and `/api/dashboard` look like the Prices portal's sign-in and dashboard (akot,
  2026-11-17, from a screenshot of the Prices dashboard): the Prices theme and its components
  (`LoginCard`, `Callout`, the dashboard panels), not the hub's style. They are a third tree in
  the boot, beside the hub and the Prices pages.
- `/api/login`: the Prices login card, "Sign in with Discord", who may sign in (Stellar
  Developers members who have cleared screening), the refusal reasons in words.
- `/api/dashboard`: a navbar as the Prices dashboard's (Dashboard, Quick start, OpenAPI Docs,
  the Discord username, Sign out); tabs "Prices API" and "x402", x402 marked "Coming soon" and
  inert while it is off (decision 5); each tab shows its key state, "Get API Key" when there is
  none, show / copy, revoke after a second click, and its `details`. The Prices tab reproduces
  what the Prices portal's dashboard shows today (key card, monthly usage, rate limit). Signed
  out, the dashboard sends the browser to `/login`.
- The hub's top bar: "Log in" in place of "Browse APIs" (akot, 2026-11-17) while signed out,
  "Dashboard" while signed in. Its section links point at the hub (`/api/#products`), not at the
  current page.
- A build switch per product (`VITE_PRODUCTS=prices` now, `prices,x402` when x402 opens) turns a
  product's tab, its hub tile's "Live" and the "N APIs live" count on and off. Everything else
  on the hub keeps the design's text (decision 8).
- The explorer's GTM container and the HubSpot consent banner load on every page of the app, as
  in the Prices portal's `index.html` (decision 9).

### The cutover (decision 5)

In this order, each step reversible on its own:

1. **BFF and sign-in** deployed and the CloudFront behaviour `/api/hub/*` added. Nothing links to
   it yet; its sign-in admits members only. Tried with the new Discord application by calling
   its sign-in directly.
2. **Prices' contract** (in `stellar-prices-api`) deployed beside its existing portal routes, so
   the old portal keeps working; the Prices tab tried against it.
3. **The switch**, tried right after on production (decision 10). The app's bundle is uploaded
   under the bucket's `api/index.html` and `api/assets/`, never under `api/prices-api/`, so the
   old Prices portal's files stay where they are; then the explorer serves `/api`, `/api/`, `/api/assets/*`, `/api/login`,
   `/api/dashboard*`, `/api/privacy-policy` and `/api/prices-api/*` from the hub bundle, removes
   its own hub page. Reverting this explorer change brings the old hub and the old Prices portal
   back at once. The behaviours for `/api/prices-api` and `/api/prices-api/*` add the response
   header `X-Robots-Tag: noindex` (akot, 2026-11-17): today the Prices portal's own `index.html`
   carries `noindex`, and in the shared bundle the static HTML is the hub's, so the Prices pages
   set it only from JavaScript, which crawlers don't reliably honour. The hub's own addresses get
   no such header. In the moved Prices pages, `/api/prices-api/login`
   and `/api/prices-api/dashboard` send the browser to `/api/login?from=prices` and `/api/dashboard/prices`. Never to a bare
   `/api/login`: a browser holding the old cached `301` from `/api/login` to
   `/api/prices-api/login` would loop; the query makes it a different URL. The same holds for
   every route in the explorer's `PRICES_PORTAL_LEGACY_ROUTES` the hub takes over:
   `/api/privacy-policy` is served by the hub too, and the Prices portal's own policy page sends
   the browser to `/api/privacy-policy?from=prices`.
4. **Prices' old sign-in removed** a release later: its `auth` routes, session and CORS for the
   portal, its Discord application retired.
5. **x402**, not in this design's plan (decision 7): `apps/portal` implements the contract instead
   of its own sign-in (stellar-x402 0106), and `VITE_PRODUCTS` gains `x402` when x402 opens.

### Privacy

One privacy policy at `/api/privacy-policy` replaces the Prices portal's, starting from its text:
what the hub keeps (the session cookie with Discord ID and username, 24 hours; logs naming
`discord:<id>`), Google Analytics through the explorer's GTM and the HubSpot consent banner
(decision 9), and what each product keeps (Prices: its API Gateway key named by the Discord ID,
usage). It must be live before the switch (step 3); x402's part (the registry row, the sealed
copy) is added before x402's tab opens.

### Logs and operations

- The BFF logs sign-in, refusals and every key event with `discord:<id>`, never a token, a key, a
  secret or a cookie. CloudWatch, in the account above.
- Secrets (Discord client secret, session signing key) in Secrets Manager; the token key in KMS.
- Rate limits on the sign-in routes: each callback with a made-up code costs a Discord request.

## Calls made by Claude, for akot to check

- The BFF's prefix `/api/hub/*`, its runtime (Node 22 Lambda, TypeScript) and that its code and
  CDK live in `sorobanscan-api-portal`.
- ES256 tokens signed in KMS, 60 seconds, products configured with the public key.
- The contract's four calls and its `details` object.
- `Get API Key` keeps a Discord round trip (`prompt=none`), as both portals do today, rather than
  trusting a sign-in up to 24 hours old.
- Account age is read only when a key is issued, not at sign-in.
- The cutover order, and `?from=prices` on every taken-over legacy route to avoid the
  cached-redirect loop.
- The Prices portal moves into the same app and bundle (not a second app), keeping MUI on its
  routes only; `web/portal` in stellar-prices-api is removed only after the switch.
- The app's bundle never overwrites the old Prices portal's files, so the switch can be undone
  by reverting the explorer's change alone.
- One privacy policy at `/api/privacy-policy`.

## Left to the builder

- Exact route names inside each product, the `details` shapes, the page's components.
- How the Lambda is packaged and deployed, and the CloudFront policies for the behaviour.
- The rate-limit mechanism (per-instance memory is weak on Lambda).
- How the Prices portal's dashboard components are carried into the Prices tab.
