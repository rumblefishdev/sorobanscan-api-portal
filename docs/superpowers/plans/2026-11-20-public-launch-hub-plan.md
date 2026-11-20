# The hub's public start: this repo's three pull requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything `sorobanscan-api-portal` needs before the hub is deployed at `/api/`: the page's three address changes, the backend's two guards, and the backend as a Lambda with its infrastructure and runbook.

**Architecture:** Three pull requests from `main`, in this order: the page (tasks 1-3), the backend's guards (tasks 4-5), the Lambda and its stack (tasks 6-8, on top of the guards' branch, since the Lambda's entry uses their settings). Nothing here deploys. The explorer's distribution is the other plan, `2026-11-20-public-launch-explorer-plan.md`.

**Tech Stack:** React 19, react-router 8, Vite 8, Vitest (projects `page` in jsdom and `bff` in node), Hono 4, `hono/aws-lambda`, AWS CDK v2 (`aws-cdk-lib`, `NodejsFunction`), Node 22.

**Spec:** `docs/superpowers/specs/2026-11-20-public-launch-design.md`. Read it first; its tables of addresses are what the tests below pin.

## Global Constraints

- Node 22.13 or later, pnpm 11. Every task ends with `pnpm test` and `pnpm typecheck` passing.
- The backend never answers `403` or `404`: `bff/test/app.test.ts` collects every status and fails a test that saw one. New backend tests record their statuses the same way.
- No new text on a page, except the one line task 5 adds to the sign-in page. Links change address, not words.
- A ported file names its source in its header, as `bff/src/cookies.ts` does.
- Branches: `fix/public-start-pages`, `feat/backend-guards`, `feat/backend-lambda`. Conventional commit subjects in the repo's form (`fix: …`, `feat: …`, `docs: …`), no co-author line.
- Never push, and never open a pull request, without akot's word.
- No secret's value in the repo, in a test's snapshot, in a synthesized template or in a log line.

## Review Focus

- A browser that kept the explorer's old `301` from `/api/privacy-policy` arrives at `/api/prices-api/privacy-policy`: it must end on the policy, once, with no loop. Task 2.
- Many people behind one address (an office, a conference) spend the sign-in routes' limit: the dashboard and the pages must keep working for them. Task 5.
- An instance that starts while Secrets Manager can't be reached: it must answer `503` and recover by itself, without a deploy. Task 6.
- `X-Hub-Viewer-Ip` absent, empty or not an address: counted as one client, never an exception. Task 4.
- "Get API Key" through a function URL arrives with its form body base64-encoded: the product named in it must still be read. Task 6.

---

## Pull request 1: the page (`fix/public-start-pages`)

### Task 1: An address under an API's page goes to that API's page

**Files:**
- Modify: `src/account/App.tsx`
- Test: `src/account/App.spec.tsx`

**Interfaces:**
- Produces: the account pages' routes `/quick-start/:product/*` and `/docs/:product/*`, and a catch-all that leaves this tree for the landing page.

- [ ] **Step 1: Write the failing tests** in `App.spec.tsx`, beside the existing docs tests. `Where` gains the address's `hash`. With `vi.stubEnv("VITE_PRODUCTS", "prices,x402")`:

```ts
it.each([
  ["/docs/prices/anything", "/docs/prices"],
  ["/docs/x402/a/b", "/docs/x402"],
  ["/quick-start/x402/extra", "/quick-start/x402"],
  ["/docs/nope/x", "/docs/prices"],            // an unknown API: the first tab
  ["/docs/prices/x#rate-limits", "/docs/prices#rate-limits"],
])("%s goes to %s", async (from, to) => { renderAt(from); await waitFor(() => expect(where).toBe(to)); });

it("keeps /docs/prices/ where it is", …);       // a trailing slash is the tab's own address: no redirect
it("leaves the account pages for the landing page at an address it doesn't know", …);
// renderAt("/login/extra"): `window.location.replace` was called once, with "/api/"
```

Stub `window.location.replace` as `src/prices/app/app.spec.tsx` does for `ToHub`.

- [ ] **Step 2: Run** `pnpm vitest run --project page src/account/App.spec.tsx`. Expected: the new tests fail (today these addresses end on `/login`).
- [ ] **Step 3: Implement.** Two routes whose element navigates, `replace`, to `/${kind}/${product}` keeping the hash (`DocsPage` then puts an unknown API on the first tab, as it does today). The catch-all's element calls `window.location.replace(import.meta.env.BASE_URL)` in an effect: the landing page is another tree, which only a page load boots, and a router `Navigate` to `/` would meet this catch-all again. Update the comment over the routes.
- [ ] **Step 4: Run** the same command, then `pnpm test`. Expected: pass.
- [ ] **Step 5: Commit** `fix: send an address under an API's page to that API's page`.

### Task 2: The privacy policy at `/api/privacy-policy`

**Files:**
- Create: `src/account/PrivacyPolicyPage.tsx`, `src/account/PrivacyPolicyPage.spec.tsx`
- Modify: `src/boot.js`, `src/account/App.tsx`, `src/prices/landing/links.ts`, `src/prices/app/app.tsx`
- Test: `test/boot.test.ts`, `src/prices/app/app.spec.tsx`

**Interfaces:**
- Produces: `PrivacyPolicyPage({ session }: { session: Session })`; in `links.ts`, `PRIVACY_POLICY = \`${import.meta.env.BASE_URL}privacy-policy\`` (every link's target) and `HUB_PRIVACY_POLICY = \`${import.meta.env.BASE_URL}privacy-policy?from=prices\`` (where the Prices pages' own route sends the browser).

- [ ] **Step 1: Write the failing tests.**
  - `test/boot.test.ts`: `isAccountPath("/api/privacy-policy", "/api/")` is `true`; `"/api/privacy-policyX"` is `false`; `isPricesPath("/api/privacy-policy", "/api/")` is `false`.
  - `PrivacyPolicyPage.spec.tsx`: at `/privacy-policy` and at `/privacy-policy?from=prices` the policy's heading is shown under the hub's bar ("Log in" for a visitor, the username for a session); the document has no `meta[name=robots]`; its canonical link is the page's origin followed by `/api/privacy-policy`, with no query (as `DocsPage.spec.tsx` asserts its own); with `VITE_PRODUCTS=prices,x402` x402's paragraph is there, with `prices` it isn't.
  - `src/prices/app/app.spec.tsx`: the Prices pages' `/privacy-policy` calls `window.location.replace("/api/privacy-policy?from=prices")`, and with `#cookies` on the address, `"/api/privacy-policy?from=prices#cookies"`. The footer's "Privacy policy" link is `href="/api/privacy-policy"`.
- [ ] **Step 2: Run** the three files. Expected: fail.
- [ ] **Step 3: Implement.**
  - `src/boot.js`: `privacy-policy` joins the names `isAccountPath` knows.
  - `PrivacyPolicyPage.tsx`: the bar as `DocsPage` draws it (`AccountNavbar` with `current="privacy-policy"`, the sign-out and its failure line), the lazy `../prices/privacy/PrivacyPolicy` under `Suspense`, `Footer`; a `<title>` and the canonical link; no `noindex`.
  - `App.tsx`: the route `/privacy-policy`.
  - `src/prices/app/app.tsx`: its `/privacy-policy` route becomes `<ToHub href={HUB_PRIVACY_POLICY} hash />`; `PrivacyPolicyRoute`, the lazy import and `'privacy-policy'` in `PageBar`'s `current` go, with their tests. The file must end shorter than it started.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat: serve the privacy policy at /api/privacy-policy`.

### Task 3: The x402 links, and no x402 page

**Files:**
- Modify: `src/links.ts`, `src/sections/Hero.tsx`, `src/sections/Products.tsx`, `src/sections/Closing.tsx`, `src/sections/Chrome.tsx`, `vite.config.ts`, `README.md`
- Test: `test/links.test.ts`, `test/page.test.tsx`, `test/dev-proxy.test.ts`, `test/vite-config.test.ts`

**Interfaces:**
- Produces: `X402_QUICK_START_URL = \`${BASE}quick-start/x402\`` in `src/links.ts`. `X402_URL` no longer exists.

- [ ] **Step 1: Write the failing tests.** `links.test.ts`: `X402_QUICK_START_URL` is `/api/quick-start/x402`, and follows another prefix as `QUICK_START_URL` does. `page.test.tsx`: the landing page has no link whose `href` contains `x402-facilitator`, and each of its four x402 links (the directory's row, the product card's primary button, the closing panel's, the footer's) is `/api/quick-start/x402`. `dev-proxy.test.ts` / `vite-config.test.ts`: no proxy entry for `/api/x402-facilitator`, with or without `DEV_X402_PAGE_TARGET` set.
- [ ] **Step 2: Run** them. Expected: fail.
- [ ] **Step 3: Implement.** Replace the constant and its five uses; remove the dev proxy for the x402 page, `DEV_X402_PAGE_TARGET` and their comments; in `README.md` remove the two paragraphs about the x402 Facilitator's own page and `DEV_X402_PAGE_TARGET`, and say in "The prefix" that the hub links to no other app's page under `/api/`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm build`. Expected: pass, and `grep -r "x402-facilitator" dist` prints nothing.
- [ ] **Step 5: Commit** `fix: point the hub's x402 links at its quick start`.

---

## Pull request 2: the backend's guards (`feat/backend-guards`)

### Task 4: The limiter and the client's address

**Files:**
- Create: `bff/src/rate-limit.ts`, `bff/src/client-address.ts`
- Test: `bff/test/rate-limit.test.ts`, `bff/test/client-address.test.ts`

**Interfaces:**
- Produces:
  - `rateLimiter(limit: number, windowMs: number, now?: () => number): RateLimiter`, `RateLimiter.hit(key: string): { allowed: boolean; retryAfterSeconds?: number }`: stellar-x402's `apps/portal/src/rate-limit.ts` at `7a5ce70d`, unchanged but for its header.
  - `clientKey(viewerIp: string | undefined): string`: the key a request is counted by, from `X-Hub-Viewer-Ip`, which CloudFront's function writes from the viewer's IP address (a bare address, no port).

- [ ] **Step 1: Write the failing tests.**

```ts
// client-address.test.ts
expect(clientKey("198.51.100.10")).toBe("198.51.100.10");
// One /56 is one client:
expect(clientKey("2001:db8:abcd:12ff:1::1")).toBe(clientKey("2001:db8:abcd:1200:ffff::2"));
expect(clientKey("2001:db8:abcd:1300::1")).not.toBe(clientKey("2001:db8:abcd:12ff::1"));
for (const odd of [undefined, "", "garbage", "198.51.100.10:46532", "1.2.3.4, 5.6.7.8", "[::1]", " 198.51.100.10"]) {
  expect(clientKey(odd)).toBe("unknown");
}
```

`rate-limit.test.ts`: the 30th hit in a window is allowed and the 31st isn't, with `retryAfterSeconds` between 1 and 60; a window later the key is allowed again; another key is never affected.

- [ ] **Step 2: Run** `pnpm vitest run --project bff bff/test/rate-limit.test.ts bff/test/client-address.test.ts`. Expected: fail, no such modules.
- [ ] **Step 3: Implement.** `clientKey` checks the value with `node:net`'s `isIPv4`/`isIPv6` and nothing else (no port, no brackets: CloudFront's function writes `event.viewer.ip` as it is), and for IPv6 keeps the first 56 bits of the expanded address.
- [ ] **Step 4: Run** the same command. Expected: pass.
- [ ] **Step 5: Commit** `feat: add a request limiter and the key a client is counted by`.

### Task 5: The two guards in the app

**Files:**
- Modify: `bff/src/app.ts`, `bff/src/settings.ts`, `src/account/LoginPage.tsx`, `README.md`
- Test: `bff/test/guards.test.ts` (new), `src/account/LoginPage.spec.tsx` (or where its outcomes are tested)

**Interfaces:**
- Consumes: `rateLimiter`, `clientKey` (task 4).
- Produces:
  - `HubSettings.originSecret?: { current: string; previous?: string }`. Absent, the app makes no such check (`pnpm dev`, `pnpm preview`). `readSettings` never sets it; the Lambda's entry does (task 6).
  - Exported from `app.ts`: `ORIGIN_SECRET_HEADER = "x-hub-origin-secret"`, `AUTH_LIMIT_PER_MINUTE = 30`, `LIMIT_PER_MINUTE = 120`.
  - Refusals: `400 {error: "not_through_the_site"}`; `429 {error: "rate_limited"}` with `Retry-After`; for `GET auth/login`, `GET auth/callback` and `POST auth/issue` over the limit, `303` to `${base}login?signin=busy`.
  - The sign-in page's outcome `busy`, shown as `data-testid="signin-busy"`: "Too many sign-in attempts from your network. Try again in a minute."

- [ ] **Step 1: Write the failing tests** in `bff/test/guards.test.ts`, with `app.test.ts`'s settings, fakes and status rule, a fixed `now`, and requests that carry `x-hub-viewer-ip`:
  - With `originSecret: { current: "a".repeat(64), previous: "b".repeat(64) }`: no header, a wrong one and one of another length each get `400 not_through_the_site`; `current` and `previous` each pass. A refused request is not counted: 200 of them, then `GET me` with the header answers `200`. The check comes before the `Origin` check: a `POST` with neither answers `not_through_the_site`, not `bad_origin`.
  - Without `originSecret`: `GET me` with no header answers `200`.
  - From one address, 30 `GET auth/login` answer `303` to Discord and the 31st `303` to `/api/login?signin=busy`; 60 seconds later, Discord again. The same 31st for `GET auth/callback` and for `POST auth/issue`.
  - From one address, 120 `GET me` answer `200` and the 121st `429 rate_limited` with an integer `Retry-After` of 1 to 60. Another address still gets `200`. Two IPv6 addresses of one /56 share the count.
  - The two budgets are apart: after 31 `auth/login`, `GET me` answers `200`; after 121 `me`, `auth/login` still goes to Discord.
  - A request with no `x-hub-viewer-ip` is counted with every other such request.
  - `LoginPage`: at `/login?signin=busy` the line above is shown and the query is taken off the address, as for the other outcomes.
- [ ] **Step 2: Run** `pnpm vitest run --project bff bff/test/guards.test.ts`. Expected: fail.
- [ ] **Step 3: Implement** three middlewares in `createHub`, in this order, before the routes: the header (`timingSafeEqual` on equal lengths, against `current` then `previous`), the limit (two limiters; a path under `${base}hub/auth/` spends the first, any other the second), then the `Origin` check that is there today. `noStore` stays first. Update the function's doc comment and the README's backend section with the two refusals and the order. If a test in `app.test.ts` now runs into a limit, it builds a hub of its own.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat: limit requests and answer only through CloudFront`.

---

## Pull request 3: the Lambda, its stack and the runbook (`feat/backend-lambda`, from `feat/backend-guards`)

### Task 6: The Lambda's entry

**Files:**
- Create: `bff/src/lambda-settings.ts`, `bff/src/lambda.ts`
- Test: `bff/test/lambda-settings.test.ts`, `bff/test/lambda.test.ts`

**Interfaces:**
- Consumes: `readSettings`, `HubSettings.originSecret` (task 5), `createHub`, `secretsManager()` and `FAILURE_TTL_MS` from `product-secret.ts`.
- Produces:
  - `loadLambdaSettings(env: Record<string, string | undefined>, read: (name: string) => Promise<string>): Promise<HubSettings>`.
  - `handler`, the function URL's handler (payload format 2.0), exported from `lambda.ts`.
  - The function's environment, all names and no values of secrets: `HUB_PUBLIC_ORIGIN`, `HUB_PRODUCTS`, `DISCORD_CLIENT_ID`, `HUB_DISCORD_SECRET_NAME`, `HUB_SESSION_SECRET_NAME`, `HUB_ORIGIN_SECRET_NAME`. The prefix is `/api/`.
  - The secrets' forms: Discord's is the client secret as plain text; the session's is plain text, base64 of at least 32 bytes (64 letters and digits is that); the header's is JSON `{"current": string, "previous"?: string}`, each at least 32 characters.

- [ ] **Step 1: Write the failing tests.**
  - `lambda-settings.test.ts`: with the six names set and a `read` that answers each, the settings hold `publicOrigin`, `products: ["prices", "x402"]`, the Discord secret, a 48-byte session secret and `originSecret.current`; a missing name, an unreadable secret, and a header secret that isn't that JSON or is shorter than 32 characters each reject with a message that names the setting and never holds a secret's value; `originSecret` is never absent from a resolved value.
  - `lambda.test.ts`, with the secrets' reader and `now` injected: an event for `GET /api/hub/me` carrying the header answers `200` `{"authenticated":false}`; without it `400`; `GET /api/hub/auth/login` answers `303` with its cookie in the result's `cookies` array; `POST /api/hub/auth/issue` with `isBase64Encoded: true`, a session cookie and the body `product=prices` in base64 answers `303` to Discord; while a secret can't be read every request answers `503 sign_in_not_configured`, the next request within `FAILURE_TTL_MS` doesn't read again, and one after it does and is served.
- [ ] **Step 2: Run** `pnpm vitest run --project bff bff/test/lambda-settings.test.ts bff/test/lambda.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.** `loadLambdaSettings` reads the three secrets, hands `readSettings` an environment with their values under its own names, and adds `originSecret`. `lambda.ts` keeps one loading promise per instance, replaced after a failure once `FAILURE_TTL_MS` has passed, logs `startup_failed <the message>` once per failure, and serves `handle(createHub(settings))` from `hono/aws-lambda`, or `createHub(undefined)` while there are no settings.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat: run the hub's backend as a Lambda`.

### Task 7: The stack

**Files:**
- Create: `infra/bin/hub.ts`, `infra/lib/backend-stack.ts`, `infra/test/backend-stack.test.ts`, `infra/cdk.json`, `infra/tsconfig.json`
- Modify: `package.json` (dev dependencies `aws-cdk-lib`, `constructs`, `aws-cdk`, `esbuild`; scripts `infra:synth`, `infra:diff`, `infra:deploy`; the type check gains `infra/tsconfig.json`), `vite.config.ts` (a Vitest project `infra`, node), `.gitignore` (`cdk.out`)

**Interfaces:**
- Consumes: `bff/src/lambda.ts`'s `handler` and the environment names of task 6.
- Produces: the stack `SorobanscanHub-production-Backend` in `eu-central-1`, with the outputs `FunctionUrlHost` and `OriginSecretName`. It needs the context value `discordClientId` (`-c discordClientId=…`) and stops the synth, naming it, without one.

- [ ] **Step 1: Write the failing test**, on the synthesized template (`Template.fromStack`):
  - One function: `nodejs22.x`, `arm64`, `Timeout: 29`, `MemorySize: 512`, `ReservedConcurrentExecutions: 20`.
  - Its environment has exactly the six names of task 6 and `NODE_OPTIONS` at most; `HUB_PUBLIC_ORIGIN` is `https://sorobanscan.com`, `HUB_PRODUCTS` is `prices,x402`; no value is a secret (`DISCORD_CLIENT_SECRET` and `HUB_SESSION_SECRET` are not keys).
  - One function URL with `AuthType: NONE`.
  - Two secrets the stack makes, retained on delete, generated without punctuation at 64 characters: `sorobanscan-hub/production/session`, and `sorobanscan-hub/production/origin-secret` with the template `{}` and the key `current`.
  - The role may `secretsmanager:GetSecretValue` on five secrets and no more: those two, `sorobanscan-hub/production/discord-client-secret`, `…/prices-token`, `…/x402-token`. No statement has `Resource: "*"` except the log group's own.
  - A log group with a retention of one month.
  - Without `discordClientId`, building the stack throws.
- [ ] **Step 2: Run** `pnpm vitest run --project infra`. Expected: fail.
- [ ] **Step 3: Implement** with `NodejsFunction` (entry `bff/src/lambda.ts`, ESM, bundled by esbuild). The three secrets the stack doesn't make are taken by name (`Secret.fromSecretNameV2`).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm infra:synth -c discordClientId=1`. Expected: pass; the template in `infra/cdk.out` holds no secret's value.
- [ ] **Step 5: Commit** `feat: add the backend's stack`.

### Task 8: The upload, the runbook and the README

**Files:**
- Create: `scripts/upload-bundle.sh`, `docs/runbook.md`
- Modify: `README.md`, `package.json` (script `upload`)

**Interfaces:**
- Produces: `scripts/upload-bundle.sh [--dryrun]`, and the runbook the deployment follows.

- [ ] **Step 1: Write `scripts/upload-bundle.sh`.** It builds with `VITE_PRODUCTS=prices,x402` and `VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com`, stops unless `dist/index.html` exists and `grep -r "x402-facilitator" dist` finds nothing, then copies `dist/` to `s3://production-soroban-explorer-api-spa/api/` in two `aws s3 sync` calls, neither with `--delete`: `assets/` with `Cache-Control: public, max-age=31536000, immutable`, the rest with `public, max-age=0, must-revalidate`. `--dryrun` is passed to both. `set -euo pipefail`; the profile is the caller's `AWS_PROFILE`.
- [ ] **Step 2: Verify** `bash -n scripts/upload-bundle.sh`, and `shellcheck` if it is installed. Expected: no output.
- [ ] **Step 3: Write `docs/runbook.md`**, from the spec's "The deployment", "The way back" and "Only through CloudFront": the seven steps with their commands (the stack's deploy with `AWS_PROFILE=stellar` and `-c discordClientId=…`; the upload; the two changes to the explorer's `infra/envs/production.json`, as `2026-11-20-public-launch-explorer-plan.md` names its settings); step 5's four addresses and what each must show; step 7's checks as one `curl` line per row of the spec's three tables, with the expected status and `Location`; the way back; how each secret is changed (the header's: `current` moves to `previous`, a new `current`, the explorer's revision setting raised and deployed, the function restarted, then `previous` removed); the account's concurrency limit checked before the first deploy.
- [ ] **Step 4: Update `README.md`:** a section "On production" that says what serves what once the start is done and points at the runbook, replacing "Neither is on production from this repo"; the backend section names the Lambda's settings.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck`. Expected: pass.
- [ ] **Step 6: Commit** `docs: add the runbook for the hub's deployment`.
