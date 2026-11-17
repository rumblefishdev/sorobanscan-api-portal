# Hub Sign-in (Local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `pnpm dev`, the hub's top bar has "Log in"; it signs a Stellar Developers member in with Discord through the hub's own backend (the BFF) and lands on `/api/dashboard`, which looks like the Prices portal's dashboard, shows the account, tabs "Prices API" and "x402", and signs out. No product data yet.

**Architecture:** The BFF is a Hono app under `bff/` (TypeScript, Node 22), mounted by a Vite plugin at `/api/hub/*` on the dev and preview servers, so one `pnpm dev` runs page and backend on one origin. It does Discord OAuth2 (PKCE, signed state) and keeps the session in a signed `HttpOnly` cookie, starting from stellar-x402's `apps/portal` sign-in code. The page gets a third boot tree, `src/account/`, for `/api/login` and `/api/dashboard`, built from the Prices portal's theme and components. AWS deployment, product tokens and the Prices tab's data are later plans.

**Tech Stack:** Hono 4 with `@hono/node-server` (`getRequestListener`) in dev, Node 22 `fetch` and `node:crypto`, React 19, MUI 7 (from `src/prices`), react-router 8, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-17-shared-sign-in-design.md` ("The session", "The page"; decisions 3, 4, 5, 6).

## Global Constraints

- BFF paths: everything under `${base}hub/` (`/api/hub/` at the default base). Routes in this plan: `GET auth/login`, `GET auth/callback`, `GET me`, `POST auth/logout`.
- Discord: exactly the scopes `identify guilds.members.read`; guild `897514728459468821` (Stellar Developers) by default; sign-in only for a member whose answer says `pending: false`.
- Refusal outcomes, as the Prices portal names them: `cancelled`, `failed`, `not_member`, `pending_rules`, `unknown` (Discord didn't answer; never reported as `not_member`).
- Cookies: session `hub_session`, `Path=/api/hub`, `HttpOnly`, `SameSite=Lax`, `Secure` unless the public origin is `http://localhost…`, 24 hours; sign-in pending `hub_oauth`, `Path=/api/hub/auth`, 10 minutes, deleted before it is checked. Both signed (HMAC-SHA256) with `HUB_SESSION_SECRET`, each with its own context so one can't stand in for another.
- The session holds the Discord id, the username and the expiry, nothing else. No Discord token is kept.
- Every `POST` must carry `Origin` equal to the public origin.
- The BFF never answers 403 or 404 for its own decisions (the production CloudFront turns those into the explorer's page): no session → 401; refused `Origin` → 400.
- Settings (env, read with `loadEnv(mode, cwd, "")`, never exposed to the bundle): `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `HUB_SESSION_SECRET` (base64, at least 32 bytes), optional `DISCORD_GUILD_ID`, `HUB_PUBLIC_ORIGIN` (default `http://localhost:5173` in dev). Local values live in `.env.development.local` (git-ignored). Without the three required ones the dev server still starts and `/api/hub/*` answers 503 `{"error":"sign_in_not_configured"}`.
- Code taken from stellar-x402 (`apps/portal/src/discord.ts`, `tokens.ts`, `cookies.ts`, Apache-2.0, same organisation) keeps a header comment naming its source file and commit.
- `src/account/` is checked by the Prices TypeScript project (it imports `src/prices`); no hub `.ts` imports `src/account` or `src/prices` (`npx tsc -p tsconfig.json --listFiles | grep -E 'src/(prices|account)'` empty).
- Product switch: `VITE_PRODUCTS` (comma list, default `prices`).
- Commits: Conventional Commits, no `Co-Authored-By`; never push. `pnpm` needs `export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH`.

## Review Focus

1. A callback replayed, started in another browser, or with a `state` from another action: refused as `failed`, no session. Pinned in Task 1.
2. Discord answering 401/5xx or timing out on the member lookup: `unknown`, never `not_member`. Pinned in Task 1.
3. The session cookie edited by hand or past its expiry: treated as signed out (`/me` says so, the dashboard goes to `/login`). Pinned in Tasks 1 and 4.
4. Sign out from another site (a `POST` without the hub's `Origin`): refused, session kept. Pinned in Task 1.
5. Dev without Discord settings: the hub and Prices pages still work; "Log in" leads to a page that says sign-in isn't configured, not a crash. Pinned in Tasks 2 and 4.

---

### Task 1: The BFF's sign-in, session and sign-out

**Files:**
- Create: `bff/src/app.ts`, `bff/src/discord.ts`, `bff/src/tokens.ts`, `bff/src/cookies.ts`, `bff/src/settings.ts`, `bff/tsconfig.json`, `bff/test/app.test.ts`, `bff/test/fake-discord.ts`
- Modify: `package.json` (`hono`, `@hono/node-server`; `typecheck` adds `tsc -p bff/tsconfig.json --noEmit`), `vite.config.ts` (test `include` adds `bff/test/**/*.test.ts`; those run in `node`)

**Interfaces:**
- Produces, in `bff/src/settings.ts`: `type HubSettings = { publicOrigin: string; base: string; discordClientId: string; discordClientSecret: string; sessionSecret: Buffer; guildId: string }` and `readSettings(env: Record<string, string | undefined>, base: string): HubSettings | undefined` (undefined when a required one is missing; throws on a malformed secret).
- Produces, in `bff/src/discord.ts` (from x402's): `interface Discord { authorizeUrl(p: {state: string; challenge: string; redirectUri: string}): string; exchange(code: string, verifier: string, redirectUri: string): Promise<{accessToken: string; scope: string}>; user(token: string): Promise<{id: string; username: string}>; member(token: string, guildId: string): Promise<"member" | "pending" | "not_member" | "unknown"> }` and `httpDiscord(settings, fetchImpl?)`.
- Produces, in `bff/src/app.ts`: `createHub(settings: HubSettings | undefined, deps?: { discord?: Discord; now?: () => number }): Hono` with the four routes under `${base}hub/`.

- [ ] **Step 1: Write the failing tests** in `bff/test/app.test.ts`, against `createHub` with `bff/test/fake-discord.ts` (a `Discord` whose answers each test sets), using `app.request(...)`:

```ts
it("sends the browser to Discord with both scopes, a state, S256 and the callback", ...)
  // 303; Location host discord.com /oauth2/authorize; scope "identify guilds.members.read";
  // code_challenge_method S256; redirect_uri `${publicOrigin}/api/hub/auth/callback`;
  // Set-Cookie hub_oauth with Path=/api/hub/auth, HttpOnly, Max-Age=600
it("signs a cleared member in and lands on the dashboard", ...)
  // callback with the cookie and state from the login response → 303 /api/dashboard;
  // Set-Cookie hub_session Path=/api/hub HttpOnly SameSite=Lax Max-Age=86400; hub_oauth cleared
it.each([["not_member","not_member"],["pending","pending_rules"],["unknown","unknown"]])(
  "refuses a %s answer as %s, without a session", ...)  // 303 /api/login?signin=<reason>, no hub_session
it("treats Discord failing on the member lookup as unknown", ...)  // fake throws → unknown
it("refuses a callback without its cookie, with another state, or replayed", ...)  // failed, no session
it("reports a denied consent as cancelled", ...)  // ?error=access_denied → cancelled
it("refuses a token with other scopes", ...)  // failed
it("tells /me who is signed in, and nobody for a bad or expired cookie", ...)
  // 200 {authenticated:true,id,username}; tampered → {authenticated:false}; now+24h+1s → false
it("signs out only with the hub's Origin", ...)  // POST no/other Origin → 400 and no clearing; right Origin → 204, cookie cleared
it("answers 503 sign_in_not_configured on every route without settings", ...)
it("never answers 403 or 404 for its own decisions", ...)  // collect statuses of all cases above
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test bff`
Expected: FAIL, `createHub` not found.

- [ ] **Step 3: Implement** `settings.ts`, `discord.ts`, `tokens.ts`, `cookies.ts` (from x402's, renamed to the hub's cookies and paths), `app.ts` (Hono, `basePath(`${base}hub`)`). State and pending cookie carry the same nonce and `action: "signin"`; the verifier lives only in the pending cookie. Log nothing yet beyond `console.info` of `signed_in discord:<id>` and refusals with their reason (never a token or cookie).

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm typecheck`
Expected: all pass, including the 324 existing tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: sign in with Discord through the hub's backend"
```

---

### Task 2: Run the BFF on the dev and preview servers

**Files:**
- Create: `bff/src/vite-plugin.ts`, `bff/test/vite-plugin.test.ts`
- Modify: `vite.config.ts`, `README.md`

**Interfaces:**
- Consumes: `createHub`, `readSettings`.
- Produces: `hubDevServer(): Plugin` mounting `getRequestListener(createHub(...).fetch)` as Connect middleware for requests whose path starts with `${base}hub/`, in `configureServer` and `configurePreviewServer`; settings from `loadEnv(mode, root, "")` with `HUB_PUBLIC_ORIGIN` defaulting to `http://localhost:<the server's port>`.

- [ ] **Step 1: Write the failing test**: start Vite programmatically (`createServer({ configFile: <repo vite.config.ts>, server: { port: 0 } })`) with the env stubbed (settings present, then absent) and `fetch` its `/api/hub/me` → 200 `{authenticated:false}`; absent → 503 `sign_in_not_configured`; `/api/` still serves the page; `/api/config` still goes to the Prices proxy rule (the plugin doesn't take it).

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test bff/test/vite-plugin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the plugin, register it in `vite.config.ts`; README: the BFF, its settings, `.env.development.local`, registering the Discord application's redirect `http://localhost:5173/api/hub/auth/callback`, and that a production deploy is a later plan.

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all pass; the built bundle contains none of the BFF (grep `dist/` for `hub_session` and `DISCORD_CLIENT_SECRET`: nothing).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: serve the hub's backend on the dev server"
```

---

### Task 3: "Log in" in the hub's top bar

**Files:**
- Create: `src/session.ts`
- Modify: `src/sections/Chrome.tsx`, `src/links.ts`, `test/page.test.tsx`

**Interfaces:**
- Produces, in `src/session.ts`: `useSignedIn(): boolean | undefined` (undefined while asking): `GET ${import.meta.env.BASE_URL}hub/me` with `credentials: "same-origin"`; anything but 200 with `authenticated: true` is signed out.
- Produces, in `src/links.ts`: `LOGIN_URL = "/api/login"`, `DASHBOARD_URL = "/api/dashboard"` (site-relative plain anchors, as the other product links).

- [ ] **Step 1: Write the failing tests** (`test/page.test.tsx`, `fetch` stubbed): the top bar's last item is a link "Log in" to `/api/login` when `/me` says signed out or fails; "Dashboard" to `/api/dashboard` when signed in; "Browse APIs" is no longer in the top bar (the hero's "Browse APIs" stays). The earlier test that the top bar has no log-in link changes to this.

- [ ] **Step 2: Run and see them fail**, **Step 3: implement**, **Step 4:** `pnpm test && pnpm typecheck`, **Step 5: commit** `feat: Log in in the hub's top bar`.

---

### Task 4: The sign-in page and the dashboard shell

**Files:**
- Create: `src/account/main.tsx`, `src/account/App.tsx`, `src/account/LoginPage.tsx`, `src/account/DashboardPage.tsx`, `src/account/AccountNavbar.tsx`, `src/account/products.ts`, `src/account/session.ts`, `src/account/*.spec.tsx`
- Modify: `src/boot.js`, `src/boot.d.ts`, `test/boot.test.ts`, `tsconfig.prices.json` (`include` adds `src/account`), `tsconfig.json` (`exclude` adds `src/account`), `vite.config.ts` (test `include` adds `src/account/**/*.spec.{ts,tsx}`)

**Interfaces:**
- Consumes: Prices' `theme`, `fonts.css`, `LoginCard`, `Callout`, `Benefits`, `DISCORD`, `DiscordIcon`, `Wordmark`, `primitives`; the BFF routes.
- Produces, in `src/boot.js`: `isAccountPath(pathname, base)`: true for `${base}login`, `${base}dashboard` and `${base}dashboard/…`; boot loads `./account/main.tsx` for those.
- Produces, in `src/account/products.ts`: `enabledProducts(setting: string | undefined): ("prices" | "x402")[]` (default `["prices"]`; unknown names ignored).
- Produces, in `src/account/session.ts`: `useSession(): { state: "loading" } | { state: "signed_out" } | { state: "signed_in"; id: string; username: string } | { state: "unconfigured" }` from `GET hub/me` (503 `sign_in_not_configured` → `unconfigured`); `signOut(): Promise<void>` = `POST hub/auth/logout` then `location.assign(base)`.

- [ ] **Step 1: Write the failing tests** (jsdom, `MemoryRouter basename="/api"`, `fetch` stubbed):
  - `isAccountPath`: `/api/login`, `/api/dashboard`, `/api/dashboard/prices` → true; `/api/loginX`, `/api/`, `/api/prices-api/login` → false.
  - `/login` renders the Prices login card with a "Sign in with Discord" link to `/api/hub/auth/login`, the line about Stellar Developers members who cleared screening, and for each `?signin=` reason (`cancelled`, `failed`, `not_member`, `pending_rules`, `unknown`) a `Callout` in words (take the wording from the Prices portal's `LoginView` for the same reasons); `unconfigured` shows "Sign-in is not configured on this server" and no button; signed in, `/login` goes to `/dashboard`.
  - `/dashboard` signed out goes to `/login`; signed in shows the navbar (Dashboard, Quick start → `/api/prices-api/quick-start`, OpenAPI Docs → `/api/prices-api/docs`, the username, Sign out), tabs "Prices API" (selected) and "x402"; with `VITE_PRODUCTS=prices`, x402 says "Coming soon" and can't be selected; the Prices tab says its key and usage connect in the next step; "Sign out" posts to `/api/hub/auth/logout` and goes to `/api/`.

- [ ] **Step 2: Run and see them fail**

Run: `pnpm test src/account test/boot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `src/account/main.tsx` as `src/prices/main.tsx` (StrictMode, ThemeProvider with Prices' `theme`, CssBaseline, `BrowserRouter basename` from `BASE_URL`), title "Soroban Scan APIs — Dashboard", `noindex` meta. `AccountNavbar` is new (not Prices' `DashboardNavbar`, whose Quick start and Docs links resolve against its own router) in the same look. No change to files under `src/prices`.

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm typecheck && pnpm build` and the `--listFiles` check.
Expected: all pass; MUI only in the Prices and account chunks.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: the hub's sign-in page and dashboard shell"
```

- [ ] **Step 6: End to end (controller, with akot's Discord application)**: `.env.development.local` with the application's id, secret and a fresh `HUB_SESSION_SECRET`; `pnpm dev`; "Log in" → Discord → `/api/dashboard` with the username; reload keeps the session; Sign out → `/api/` with "Log in". A non-member refusal is not tried unless akot has such an account.
