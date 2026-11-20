# The hub opens to everybody at `/api/`

Design, 2026-11-20. This is the cutover of `2026-11-17-shared-sign-in-design.md` (its steps 1 and
3), as akot decided it on 2026-11-20: a public start, x402 included, with the addresses under
`/api/` settled in one place. It replaces the trial at `/api/test/` behind Basic Auth that was
planned on 2026-11-19, which is not built.

## Intent

`https://sorobanscan.com/api/` and every address under it are served by this repo's app and its
backend, for everybody. A developer reads about the APIs, opens the quick start and the reference
without signing in, signs in with Discord, and gets a key for the Prices API and for the x402
Facilitator on one dashboard.

Today every address under `/api/` is the explorer's: its own hub page at `/api/`, the old Prices
portal at `/api/prices-api/`, the x402 Facilitator's page at `/api/x402-facilitator/` behind a
password, and redirects for the rest. This app is on `main` with both tabs working against
production's two product backends (tried from a local hub, 2026-11-20), and has no deployment: its
backend is a Hono app with no Lambda entry, no infrastructure code and no pipeline.

## Decisions made with akot (2026-11-20)

1. **A public start at `/api/`.** No trial address and no Basic Auth. The first deployment is the
   opening: Prices' users sign in through the hub from that day.
2. **x402 is in the start.** Its tab, quick start and reference are on: the build is
   `VITE_PRODUCTS=prices,x402`, the backend `HUB_PRODUCTS=prices,x402`. This replaces decision 5
   of the shared sign-in design ("the hub opens with Prices; x402 follows") and its anti-goal
   "x402 shown as live before it opens".
3. **`/api/x402-facilitator/` goes away.** No page is served there; the address answers as any
   address the hub doesn't know. "We don't need it."
4. **x402's texts stay as they are.** The tab and the quick start say the key is for
   `stellar:pubnet` only and that testnet needs none. They don't say that pubnet refuses requests
   until stellar-x402's 0126, and that is left so.
5. **The backend limits requests** (below, "The request limit"), before the start.
6. **The backend answers only through CloudFront** (below, "Only through CloudFront"), before the
   start.
7. **An address under an API's reference goes to that API's reference.**
   `/api/docs/prices/anything` goes to `/api/docs/prices`, `/api/docs/x402/anything` to
   `/api/docs/x402`. Today both end on the sign-in page for a visitor who isn't signed in.
8. **The privacy policy is at `/api/privacy-policy`**, not `/api/prices-api/privacy-policy`.
9. **The session shares its origin with the explorer, and that is accepted for the start.** A
   Content Security Policy on the explorer's pages is a task of its own in that repo.
10. **Prices' own sign-in stays in its backend until after the start**, as the way back.
11. **Pull requests first, deployment after.** The fixes and what the deployment needs are
    reviewed and merged in every repo; only then is anything deployed.
12. **The function URL's host is kept out of git**, as both repos are public: the hub's stack
    writes it into an SSM parameter, which the explorer's stack reads when it deploys (below,
    "The backend in AWS"). From the review of the launch.
13. **The function and its log group have fixed names**, set before the stack's first deploy,
    when a name costs nothing: a rename later replaces the function, and its URL's host with it.
14. **Two alarms on the backend**, to stellar-x402's alarm topic (below, "The backend in AWS").

## Approaches considered for the addresses

- **A behaviour per address** in the explorer's distribution, as the shared sign-in design's
  step 3 lists them (`/api/login`, `/api/dashboard*`, `/api/quick-start*`, …). A dozen behaviours,
  and every new page of the hub is a deploy of the explorer; decision 30 of that design already
  had to add two.
- **Everything under `/api/` is the hub's page.** One behaviour and no list, but an address
  nobody has (`/api/foo`) shows the landing page under a wrong address, with status 200.
- **One function with the list of the hub's names (picked).** One CloudFront Function for
  `/api/*` knows the first segments that are the hub's and answers the rest as today. A new page
  under a name the hub already has needs nothing from the explorer; an unknown address keeps its
  `302`; the list is six words long.

## Goals

- Every address under `/api/` has one written answer (the table below), and the code of both
  repos gives it.
- What needs a session and what needs a fresh Discord answer is unchanged from the shared sign-in
  design: this design moves no gate.
- The explorer's change can merge and be released without changing production, and takes effect
  by a setting. The same setting is the way back.
- The old Prices portal's files stay in the bucket, so the way back shows it working.

## Non-goals

- A firewall (AWS WAF) on the distribution, or Cloudflare in front of `sorobanscan.com`.
- A Content Security Policy for the explorer (decision 9).
- Removing Prices' own sign-in, `web/portal` in stellar-prices-api, or `apps/portal-web` in
  stellar-x402. Each is a pull request in its repo after the start.
- New text on any page, beyond the links that change address.
- A pipeline that deploys the hub on a push. The first deployments are by hand, from a runbook.

## Anti-goals

- A deploy of the explorer that changes `/api/` before the hub's backend and bundle are there.
- The backend reachable at its own AWS address by anyone who finds it.
- A visitor sent round a redirect loop by a `301` their browser kept.
- A secret in git, in a build's output or in a log.

## Constraints (read in the repos, 2026-11-20)

- `sorobanscan.com` is the explorer's CloudFront distribution (`soroban-block-explorer`,
  `infra/src/lib/stacks/delivery-stack.ts`). It turns every `403` and `404` from an origin into
  the explorer's `index.html` with `200`. It has no AWS WAF, on purpose (its ADR 0048), no CSP,
  and Cloudflare is not in front of it (the record is DNS-only). Each behaviour takes one
  viewer-request function. Its settings are per environment (`infra/envs/production.json`), and
  testnet's distribution is the same stack.
- Under `/api/` today: `/api` and `/api/` are the explorer's own page (`ApiHubPage`, a route of
  its app); `/api/prices-api*` the old Prices portal from the bucket
  `production-soroban-explorer-api-spa`, prefix `api/prices-api/`; `/api/x402-facilitator*` the
  x402 page behind Basic Auth (`enableX402PortalBasicAuth`); `docs`, `dashboard`, `login`,
  `quick-start`, `privacy-policy` and `openapi.json` answer `301` to the same path under
  `/api/prices-api` (`PRICES_PORTAL_LEGACY_ROUTES`), and browsers keep those; anything else
  answers `302` to `/api/`.
- The hub's bundle is one `index.html` whose boot script picks a tree by the address
  (`src/boot.js`): the Prices pages under `prices-api`, the account pages (`login`, `dashboard`,
  `quick-start`, `docs`), the landing page for the rest. Its files are `index.html`, `assets/*`,
  `docs/x402/openapi.json` and `prices-api/openapi.json`.
- The backend (`bff/src/app.ts`) answers under `/api/hub/`. It never answers `403` or `404`. A
  `POST` must carry `Origin: https://sorobanscan.com`. Its cookies are `HttpOnly`, `Secure`,
  host-only, `SameSite=Lax`, with the paths `/api/hub` and `/api/hub/auth`. It has no request
  limit. The callback of "Get API Key" may take 25 seconds.
- CloudFront's own lock for a Lambda function URL (origin access control) needs the browser to
  send the body's SHA-256 in a header on every `POST` (AWS's CloudFront guide, "Restrict access
  to an AWS Lambda function URL origin"). "Get API Key" is an HTML form, which can't.
- The secrets `sorobanscan-hub/production/prices-token` and `…/x402-token` exist in AWS Secrets
  Manager, in the account and region of the distribution and Prices (`eu-central-1`).

## Design

### Who may do what

Three levels, as the code has them today:

- **Everybody:** every page, since pages are static files, and four of the backend's addresses:
  `auth/login`, `auth/callback`, `me`, `auth/logout`.
- **Signed in:** `<api>/account`, `<api>/key/reveal`, `<api>/key/revoke`. Only a member of
  Stellar Developers who has cleared Membership Screening gets a session.
- **Signed in, with a fresh answer from Discord:** a key (`auth/issue` and its callback): the
  session's own account, a member, screened, at least 5 minutes old, and the product's own rules.

The dashboard is private by its data only. Its page loads for anybody and sends a visitor without
a session to the sign-in page. The products' backends take the hub's token and no browser.

### The addresses

Pages, from the hub's bundle:

| Address | Who | Answer |
| --- | --- | --- |
| `/api` | everybody | `301` to `/api/` |
| `/api/` | everybody | the landing page; indexed |
| `/api/quick-start/<api>`, `/api/docs/<api>` | everybody | the quick start and the reference; indexed. With no API named, or one that isn't on, the first tab's address. With anything after the API, that API's address (decision 7) |
| `/api/login` | everybody | the sign-in page; a signed-in visitor goes on to the dashboard; `noindex` |
| `/api/dashboard`, `/api/dashboard/<api>` | signed in | the dashboard; without a session, `/api/login`; `noindex` |
| `/api/privacy-policy` | everybody | the privacy policy, with x402's paragraph; indexed |
| `/api/prices-api/` | everybody | the Prices API's page; `noindex`, by the header `X-Robots-Tag` |
| `/api/prices-api/login`, `…/dashboard`, `…/quick-start`, `…/docs`, `…/privacy-policy` | everybody | the page sends the browser to the hub's page for it, as it does today for the first four |
| `/api/assets/*` | everybody | the bundle's files, cached for long: their names carry a hash |
| `/api/docs/x402/openapi.json`, `/api/prices-api/openapi.json` | everybody | the two OpenAPI documents |

The backend, under `/api/hub/`:

| Address | Who | Answer |
| --- | --- | --- |
| `GET auth/login` | everybody | `303` to Discord |
| `GET auth/callback` | everybody | `303` to the sign-in page or the dashboard, with the outcome |
| `GET me` | everybody | `200`: `{authenticated: false}`, or the account |
| `POST auth/logout` | everybody | `204`, the session ended |
| `GET <api>/account`, `POST <api>/key/reveal`, `POST <api>/key/revoke` | signed in | the product's answer; `401 not_signed_in` without a session |
| `POST auth/issue` | signed in | `303` to Discord; without a session, `303` to `/api/login` |
| any other | | `400 unknown_route` |
| any, over the limit | | `429 rate_limited` |
| any, not through CloudFront | | `400`, before anything else is read |

Old addresses:

| Address | Answer |
| --- | --- |
| `/api/x402-facilitator`, and anything under it | as any unknown address: `302` to `/api/` |
| `/api/openapi.json` | `301` to `/api/prices-api/openapi.json`, as today |
| `/prices-api*`, `/pricing-api*` | `301` to the same path under `/api/prices-api`, as today |
| any other `/api/…` | `302` to `/api/`, without its query, as today |
| the old host, `sorobanscan.rumblefish.dev` | `301` to the same address on `sorobanscan.com`, in one hop, as today |

A browser that kept the old `301` from `/api/login`, `/api/dashboard`, `/api/docs`,
`/api/quick-start` or `/api/privacy-policy` jumps to the address under `/api/prices-api/` before
asking anybody. That address is now the hub's bundle, whose Prices pages send it to the hub's page
with a query (`?from=prices`) or to a tab's address: a different URL, so no loop. The first four
are built; `privacy-policy` is added by this design.

Known and left: a file that isn't in the bundle, under one of the hub's names
(`/api/docs/x402/nope.json`), gets the explorer's `index.html` with `200`, as every missing file
on the distribution does.

### The explorer's distribution

One pull request in `soroban-block-explorer`, with a task of its own there.

- **Settings arm it, in two stages.** `infra/envs/production.json` gains the hub's values.
  Without them the stack builds what it builds today, so the pull request merges and is released
  with no change to production, and testnet never changes.
  - *The backend:* the name of the SSM parameter that holds its function URL's host, and the
    name of the secret for the header (below). With these alone the stack adds `/api/hub/*`
    and changes nothing else: every page is still the
    explorer's and the old Prices portal's, and nothing links to the backend. This is the shared
    sign-in design's step 1, and it is how the backend is tried from AWS before anybody is sent
    to it ("The deployment").
  - *The pages:* a switch of its own, which needs the backend's values. It is the start, and
    turning it off is the way back.
- **With both stages on, the behaviours under `/api` are:**
  - `/api`, exactly: `301` to `/api/`.
  - `/api/hub/*`: the backend. Its origin is the function URL, HTTPS only, with the secret header
    added by CloudFront. Nothing cached, every method allowed, cookies and the query forwarded,
    and of the headers at least `Origin`, `Content-Type`, `Accept` and `X-Hub-Viewer-Ip`.
    Not `Host`: a function URL answers only to its own. A viewer-request function writes the
    viewer's IP address (`event.viewer.ip`) into `X-Hub-Viewer-Ip`, replacing whatever the viewer
    sent under that name, and removes a viewer's own `X-Hub-Origin-Secret` and
    `X-Hub-Origin-Revision` (CloudFront's origin headers overwrite those anyway).
  - `/api/assets/*`: the bucket, with the long cache the explorer's own `/assets/*` has.
  - `/api/prices-api` and `/api/prices-api/*`: the hub's function, and a response-headers policy
    that adds `X-Robots-Tag: noindex` to the explorer's shared one.
  - `/api/*`: the hub's function.
  - Gone: the two behaviours of `/api/x402-facilitator`, its function, and `/api/` as a route of
    the explorer's app.
- **The hub's function** (one source, for `/api/*` and the two Prices behaviours), in this order:
  the old host's `301`; then by the first segment after `/api/`:
  - none (`/api/`), or one of `login`, `dashboard`, `quick-start`, `docs`, `privacy-policy`,
    `prices-api`: a last segment with a `.` is a file and goes to the bucket as asked; anything
    else is rewritten to `/api/index.html`.
  - `openapi.json`: the `301` above.
  - anything else: `302` to `/api/`.
- **Nothing changes in the explorer's app.** It has no link to `/api/`: its navigation and footer
  carry one link, "Prices API", to `/api/prices-api/`, a plain anchor already
  (`libs/ui/src/layout/links.ts`), so it reaches CloudFront and gets the hub's bundle.
  `ApiHubPage` and its route stay until the clean-up after the start, so the way back shows the
  old hub. A link from the explorer to the hub itself is not part of this design.
- Its tests cover each row of the three tables above that the distribution answers, with both
  stages on; the backend's behaviour alone, with the first; and today's answers, with neither.

### The backend in AWS

In this repo: the Lambda's entry, its infrastructure as a CDK app, and a runbook.

- **The function:** Node 22, the Hono app behind `hono/aws-lambda`, one function URL with no
  IAM auth (the header is the lock), a timeout above the callback's 25 seconds and under
  CloudFront's 30, its log group with a retention. Its name is `sorobanscan-hub-production-backend`
  and its log group's `/aws/lambda/sorobanscan-hub-production-backend` (decision 13).
- **Its settings:** `HUB_PUBLIC_ORIGIN=https://sorobanscan.com`, `HUB_PRODUCTS=prices,x402`, the
  prefix `/api/`, and Discord's client id, as plain settings. Discord's client secret, the
  session's signing secret and the header's secret are read from Secrets Manager when an instance
  starts, never from the function's environment. An instance that can't read one answers
  `503 sign_in_not_configured`, as the app does today without its settings.
- **Its role** reads those three secrets and the two products' token secrets, and nothing else.
- **The secrets:** the session's and the header's are made by the stack with generated values,
  so nobody types or sees them. Discord's is put in by akot from the production Discord
  application, whose redirect is `https://sorobanscan.com/api/hub/auth/callback`.
- **The function URL's host** goes into the SSM parameter
  `/sorobanscan-hub/production/backend-host`, written by the stack; the explorer's setting names
  the parameter, and its stack reads the value each time it deploys (decision 12). The host is
  in neither repo nor in the stack's outputs, and the hub's stack is deployed before the
  explorer's (step 4 below). A host that leaks is replaced by two deploys of the hub's stack,
  without its URL and then with it, and a release of the explorer: Lambda keeps one URL per
  function, under one address, and a new URL gets a new one. The runbook has the steps and the
  outage they cost.
- **Two alarms** (decision 14), to stellar-x402's SNS topic `x402-production-alarms` (Slack's
  `#stellar-x402-bot`), whose ARN the stack takes as a context value: Lambda's `Throttles`, a Sum
  of 1 or more in 5 minutes, and the function URL's `Url5xxCount`, 5 or more in 5 minutes
  (function errors, timeouts, an instance that can't read its secrets, a product down). Five
  minutes with no data is not a fault.
- **The bundle** is built with `VITE_PRODUCTS=prices,x402` and
  `VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com`, and copied to the bucket under
  `api/` without deleting anything there: the old Prices portal's `api/prices-api/index.html` and
  its assets stay, and so do an earlier build's assets, which a page loaded before a deploy still
  asks for. The bundle's own `prices-api/openapi.json` replaces the old portal's file of that
  name, which is the same document.
- **The runbook** has the first deployment in the order below, the checks, the way back, and how
  each secret is changed.

### The request limit

Two layers, both in this repo:

- **By address, in the app:** 30 requests a minute to the three that call Discord
  (`auth/login`, `auth/callback`, `auth/issue`), 120 a minute to the rest, as stellar-x402's
  portal backend first had them, except `GET me`, which isn't counted: it reads the request's
  cookie and calls nobody, and the sign-in page asks it every 1.5 s while a sign-in window is
  open, so counting it would spend the dashboard's budget and report a sign-in that succeeded
  as failed (found in review, 2026-11-20). `auth/logout` calls nobody either and is in the 120.
  The address is `X-Hub-Viewer-Ip`, which CloudFront's function writes from the viewer's
  address (above); an IPv6 address counts by its /56, as in that backend. Over the limit: `429 rate_limited` with `Retry-After`. For the three addresses a
  browser opens as a page (`auth/login`, `auth/callback`, `auth/issue`) the refusal is a page, as
  `auth/issue`'s refusals are today.
- **A ceiling on instances** (reserved concurrency) of 20. The count above is kept in each
  instance's memory, so the ceiling is what bounds it, and it bounds the cost and the rate of
  calls to Discord whatever the addresses.

Why: `auth/login` gives anybody a signed `state` and its cookie, and `auth/callback` with those
and a made-up `code` costs Discord a request from the hub's application. Repeated, Discord limits
the application and nobody signs in.

What it doesn't stop: requests from many addresses at once, which only the ceiling bounds, and
which then take the dashboard away from everybody for as long as they last. The ceiling also
caps the function URL at 200 requests a second, 10 times its reserved concurrency (AWS's Lambda
guide, "Throttling function URLs"); past either, the URL answers `429` to everybody. Keeping the
host out of git (decision 12) closes only the direct path: a flood through CloudFront to
`GET me`, which the limit doesn't count, reaches the Lambda just as a direct one would. The
`Throttles` alarm says when it happens. Accepted for the start; AWS WAF's rate rule is the
answer if it is seen.

### Only through CloudFront

- CloudFront adds a header, `X-Hub-Origin-Secret`, to every request it sends to the function URL.
  The app compares it in constant time with the secret's `current` value, and `previous` when
  there is one, before the limit, the `Origin` check and every route. Without a match: `400`.
  Direct calls never pass the distribution, but `400` keeps the app's rule of no `403`, and a
  distribution set up wrongly then shows as the page's own "couldn't reach the backend", not as
  the explorer's page.
- The secret is `{"current", "previous"?}`, the form of the products' token secrets. The
  explorer's stack reads `current` at deploy time by a reference to Secrets Manager; the value is
  in neither repo.
- `pnpm dev` and `pnpm preview` have no such secret and make no such check. The Lambda's entry
  refuses to serve without it.
- The address in `X-Hub-Viewer-Ip` is trusted by the limit only because of this check.
- The check refuses a direct call, but the call still invokes the function and counts against
  its ceiling, so the host is kept out of git too (decision 12). That closes only the direct
  path ("The request limit").

### Changes in the page

- **Decision 7.** In the account pages, an address with anything after the API's name goes to
  that API's address, for the reference and for the quick start, which is the same page with the
  same tabs. An address the account pages don't know at all goes to `/api/`, not to the
  dashboard.
- **Decision 8.** `/api/privacy-policy` is a page of the account pages, under the bar every other
  page has, with the text it has today (x402's paragraph with `VITE_PRODUCTS`). The Prices pages'
  `/privacy-policy` sends the browser to `/api/privacy-policy?from=prices`, keeping its `#part`.
  Every link to the policy names the new address.
- **Decision 3.** Every link to the x402 Facilitator's page (the landing page's directory, its
  product card, its closing panel, the footer) goes to `/api/quick-start/x402`. The dev server's
  proxy for `/api/x402-facilitator` and its `DEV_X402_PAGE_TARGET` go.
- The README says what is on production, and how.

### The pull requests (decision 11)

In `sorobanscan-api-portal`, each from `main`:

1. The page: decisions 7, 8 and 3.
2. The backend's two guards: the header's check and the request limit.
3. The Lambda's entry, the CDK app and the runbook.

In `soroban-block-explorer`:

4. The distribution, armed by its settings. Infrastructure only: nothing in the explorer's app.

None deploys anything. 1 to 3 don't depend on each other except that 3 uses 2's settings; 4
depends on none of them.

### The deployment, after all four are merged

1. akot: the production Discord application and its secret in Secrets Manager.
2. The hub's stack, with the alarm topic's ARN. Then, at the function URL's own address, read
   from the parameter: no header, `400`.
3. The bundle to the bucket. Nothing serves it yet: `/api/assets/…` still answers `302`.
4. In the explorer: the pull request that sets the backend's two names (the host's parameter,
   the header's secret), and its deploy. Only `/api/hub/*` changes.
5. The backend tried from AWS, by akot in a browser, at its addresses: `/api/hub/auth/login`
   through Discord and back (the callback then sends the browser to `/api/dashboard`, which is
   still the old portal's, and that is expected); then `/api/hub/me`, `/api/hub/prices/account`
   and `/api/hub/x402/account`, each of which must show its JSON. This is the first time the
   products are called from AWS's addresses and not from a laptop: Cloudflare is in front of both
   (the shared sign-in design's decisions 16 and 25), and a refusal there shows as
   `prices_unavailable` or `x402_unavailable`. It is put right in `soroban-infrastructure` before
   the next step.
6. In the explorer: the pull request that turns the pages on, and its deploy. This is the start.
7. The checks: each row of the three tables, with `curl`; then in a browser the sign-in, both
   tabs with their keys, Show and Copy, a sign-out, and an old address
   (`/api/prices-api/login`).

**The way back** from the start is step 6 reverted and deployed: the explorer's hub, the old
Prices portal on its own sign-in and the x402 page behind its password are back, each from files
nobody touched. Keys issued through the hub are the products' own and stay.

### After the start, each a pull request of its own

- The explorer: `ApiHubPage`, `enableX402PortalBasicAuth` and what only the unarmed path needs.
  The bucket's `api/x402-facilitator/` and the key `auth-token-x402` in the KeyValueStore.
- stellar-x402: `apps/portal-web` and what deploys it; its pull request #212 closed; 0106's notes.
- stellar-prices-api: its own sign-in, session and CORS, `web/portal`; its Discord application
  retired (the shared sign-in design's step 4).
- The explorer: a Content Security Policy, report-only first (decision 9).

## Calls made by Claude, for akot to check

- One function with a list, and the settings that arm the explorer's change in two stages: the
  backend first, tried from AWS with nothing pointing at it, then the pages. Two deploys of the
  explorer instead of one, so that the first real use of the backend is not the public's.
- Decision 7 applies to the quick start too, and an unknown address among the account pages goes
  to `/api/`.
- The x402 links go to `/api/quick-start/x402`.
- `/api/prices-api/` stays `noindex` (akot, 2026-11-17), although the start is public; the
  privacy policy, at its new address, is indexed.
- The numbers: 30 and 120 a minute, the ceiling of 20; `me` not counted.
- `400`, not `403`, for a call that didn't come through CloudFront.
- The client's address in a header of our own, `X-Hub-Viewer-Ip`, written by CloudFront's function
  from `event.viewer.ip`, and not CloudFront's `CloudFront-Viewer-Address`: AWS's guide doesn't say
  whether that header replaces one of the same name a viewer sends, nor whether a viewer-request
  function sees it (found while building, 2026-11-20). AWS's own example function adds
  `True-Client-IP` the same way.
- The session's and the header's secrets are generated by the stack.
- The first deployments by hand from a runbook; the explorer's own hub page and the x402 page's
  files stay until after the start, for the way back.

## Left to the builder

- The names of the explorer's two settings, of the three secrets, of the stack, and the CDK app's
  layout.
- How the Lambda is packaged, its memory, its logs' retention.
- The origin request policy's exact headers, within what "The explorer's distribution" requires.
- How a refused page request (`429` on `auth/login`, `auth/callback`, `auth/issue`) is worded on
  the sign-in page.
- How the explorer's stack takes the secret's value without it reaching the template in git, and
  what a change of the secret needs from a deploy there.
- Reserved concurrency needs the account's limit to leave room for it: checked at the first
  deploy.
