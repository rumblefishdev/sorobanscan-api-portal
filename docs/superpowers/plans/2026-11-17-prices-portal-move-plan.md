# Prices Portal Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Prices API portal (stellar-prices-api `web/portal`) lives in this repo and is served by this app at `/api/prices-api/…`, looking and behaving exactly as it does on `https://sorobanscan.com/api/prices-api/` today, including its own Discord sign-in and dashboard against Prices' backend.

**Architecture:** One Vite bundle, two route trees chosen at boot by the address. A tiny entry (`src/boot.js`) first runs the Prices OAuth popup bridge, then dynamically imports either the hub's entry or the Prices portal's entry. Each entry brings its own CSS, fonts and router, so neither tree's global styles reach the other, and the Prices code keeps its absolute routes under its own `BrowserRouter` (basename `/api/prices-api`) unchanged. The copied Prices code is type-checked by a project of its own with its original compiler strictness.

**Tech Stack:** React 19, Vite 8.3.8, react-router 8.5.1, MUI 7.3.11 with emotion 11.14, Vitest 5 + jsdom 31, TypeScript 6, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-11-17-shared-sign-in-design.md` (decisions 7 and 9, "The Prices portal moves in"). This plan is its first slice: the move, with the portal's own sign-in still in place. Replacing that sign-in with the hub's is a later plan.

**Source:** stellar-prices-api at `origin/develop` `7d9e9e70` (the last change under `web/portal` is `28be76c3`). Read it with `git -C /home/fish/Projects/stellar-prices-api show 7d9e9e70:<path>` or export it with `git -C /home/fish/Projects/stellar-prices-api archive 7d9e9e70 web/portal | tar -x -C <empty dir>`. Never change that repo.

## Global Constraints

- The Prices pages' text, look, routes, backend calls and behaviour stay as they are at the source commit. Code changes in copied files are limited to what this plan names: the `react-router-dom` → `react-router` import specifier, the base path, the entry, and test paths. Each other change needed to compile or pass is listed in the task's report.
- Copied files keep their names and layout under `src/prices/` (`web/portal/src/X` → `src/prices/X`), their code style (single quotes, as Prices formats them) and their comments.
- `react-router` 8.5.1 only; no `react-router-dom` dependency.
- New dependencies at exactly the source's locked versions: `@mui/material` 7.3.11, `@mui/icons-material` 7.3.11, `@emotion/react` 11.14.0, `@emotion/styled` 11.14.1.
- Analytics (spec decision 9): the explorer's GTM container `GTM-TBF2GP5S` and HubSpot portal `8102665`, with Prices' consent-mode defaults, load on every page of the app, as in Prices' `index.html`. These two hosts (`www.googletagmanager.com`, `js.hs-scripts.com`) are the only other hosts the built page may name; the hub's "no other host" test changes to that allow-list.
- The hub's pages keep looking exactly as they do (`localhost:5173/api/`); none of the Prices CSS, MUI baseline or fonts load on them, and none of the hub's `styles.css` or fonts load on the Prices pages.
- The Prices backend origin is the build setting `VITE_PORTAL_API_ORIGIN` (production `https://prices-api.sorobanscan.com`); nothing in this repo hardcodes it in runtime code.
- No deploy, no CloudFront change, no change in other repos. Commits: Conventional Commits, no `Co-Authored-By`; never push.
- `pnpm` needs `export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH`; the `${NODE_AUTH_TOKEN}` WARN is the user's npmrc.

## Review Focus

1. The Discord sign-in popup: the popup lands on `/api/prices-api/?signin=…`; it must close itself before any tree mounts and hand the outcome to the opener. Pinned in Task 2 (boot test with `window.opener`/`window.name` set).
2. An address under `/api/prices-api` with no trailing slash, or a deep link (`/api/prices-api/dashboard`, `/api/prices-api/docs#…`): it must boot the Prices tree, not the hub. Pinned in Task 2.
3. A hub address that merely starts with the letters (`/api/prices-apiX`, `/api/prices`): it must boot the hub. Pinned in Task 2.
4. Moving between the hub and Prices (the hub's "Explore Prices API", Prices' links back): full page loads, each tree's styles only. Checked in the browser in Task 3.
5. Local dev without a backend proxy target: the Prices pages render and report the backend as unreachable the way they do today, rather than breaking. Checked in Task 3.

---

### Task 1: Copy the portal in, with its dependencies, its type check and its tests

**Files:**
- Create: `src/prices/**` (everything under source `web/portal/src/`), `public/prices-api/openapi.json` (source `web/portal/public/openapi.json`), `src/prices/assets/favicon.svg`, `src/prices/assets/favicon.ico`, `src/prices/assets/apple-touch-icon.png` (source `web/portal/public/`), `tsconfig.prices.json`, `test/setup.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts` (test block only)
- Leave out (they test Prices' own `vite.config.mts`, `index.html` or repo layout, and are replaced in Tasks 2–3): `src/prices/base-path.spec.ts`, `src/prices/dev-proxy.spec.ts`, `src/prices/strip-html-comments.spec.ts`, `src/prices/consent-mode.spec.ts`, `src/prices/main.spec.tsx`, `src/prices/styles.css`, `src/prices/vite-env.d.ts`

**Interfaces:**
- Produces: `src/prices/app/app.tsx` default-exporting the portal's `App`; `src/prices/theme/theme.ts` `theme`; `src/prices/theme/fonts.css`; `src/prices/landing/oauthPopup.ts` `bridgeOAuthPopup(): boolean`; `src/prices/base-path.ts` `BASE_PATH`, `ROUTER_BASENAME` (unchanged in this task).
- Produces: scripts `typecheck` = `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.prices.json --noEmit`; `test` runs hub tests and Prices specs.

- [ ] **Step 1: Copy and wire**

Copy the files above byte for byte from the source commit. Replace every `from 'react-router-dom'` with `from 'react-router'` (that is the only edit in copied source in this task). Add the four dependencies. `tsconfig.prices.json`: `include: ["src/prices"]`, the source's compiler options (root `tsconfig.base.json` merged with `web/portal/tsconfig.app.json` and `tsconfig.spec.json`: `strict`, `noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `isolatedModules`, `target es2022`, `jsx react-jsx`, `module esnext`, `moduleResolution bundler`, `lib dom, esnext`, `types` `vite/client`, `vitest/importMeta`, `node`, `allowImportingTsExtensions`, `noEmit`), not this repo's `noUncheckedIndexedAccess` or `verbatimModuleSyntax`; declare `ImportMetaEnv.VITE_PORTAL_API_ORIGIN?: string` in a `src/prices/env.d.ts`. `tsconfig.json`: add `"exclude": ["src/prices"]`. Vitest: `include` adds `src/prices/**/*.spec.{ts,tsx}`, `setupFiles: ["test/setup.ts"]` where `test/setup.ts` registers `afterEach(cleanup)` from `@testing-library/react` (the Prices specs relied on `globals: true` for that).

- [ ] **Step 2: Run the copied specs and the type checks**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: every copied spec passes as it did in Prices (the source has about 220 cases across `app.spec`, `api-origin.spec`, `links.spec`, `openapi.spec`, `ApiReference.spec`, `PrivacyPolicy.spec`, `QuickStart.spec`; `QuickStart.live.spec` skips without `PRICES_API_KEY`); the hub's 33 tests pass. `links.spec.ts` reads `../../../../infra/envs/production.json`, which is not in this repo: replace that read with the literal API base it yields at the source commit (`https://prices-api.sorobanscan.com`), naming the source in a comment. Any other failure (jsdom 31 vs Prices' 22, TS 6 vs 5.9): fix minimally, list it in the report with the reason.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: copy the Prices portal in from stellar-prices-api 7d9e9e70"
```
The body names the source commit, the files left out and why, and every edit beyond the import specifier.

---

### Task 2: Boot either tree, one index.html with Prices' analytics

**Files:**
- Create: `src/boot.js`, `src/hub/main.tsx` (the current `src/main.tsx`'s rendering, its `styles.css` and fontsource imports), `src/prices/main.tsx` (from source `web/portal/src/main.tsx`), `test/boot.test.ts`, `src/prices/consent-mode.spec.ts` (from source, reading this repo's `index.html`), `src/prices/main.spec.tsx` (from source, against `src/prices/main.tsx`)
- Delete: `src/main.tsx`
- Modify: `index.html`, `src/prices/base-path.ts`, `src/prices/app/app.tsx` (only to render `<title>` and the robots meta, see Step 4), `test/base-path.test.ts`

**Interfaces:**
- Consumes: Task 1's `bridgeOAuthPopup`, the Prices `App`, `theme`, `fonts.css`; the hub's `App`, `routerBasename`.
- Produces, in `src/boot.js` (plain JS so the hub's type check doesn't follow it into `src/prices`):
  - `export function isPricesPath(pathname, base)`: true when `pathname` is `${base}prices-api` or starts with `${base}prices-api/` (base as `import.meta.env.BASE_URL`, e.g. `/api/`).
  - module body: `if (!bridgeOAuthPopup()) import(isPricesPath(location.pathname, import.meta.env.BASE_URL) ? "./prices/main.tsx" : "./hub/main.tsx")`.
- Produces, in `src/boot.d.ts`: `export function isPricesPath(pathname: string, base: string): boolean;` so `test/boot.test.ts` type-checks against the JS module without `allowJs`.
- Produces, in `src/prices/base-path.ts`: `BASE_PATH = import.meta.env.BASE_URL + 'prices-api/'`, `ROUTER_BASENAME` as before (so a build for another base keeps the Prices links right).

- [ ] **Step 1: Write the failing tests**

```ts
// test/boot.test.ts
describe("isPricesPath", () => {
  it.each(["/api/prices-api", "/api/prices-api/", "/api/prices-api/dashboard", "/api/prices-api/docs"])(
    "boots Prices for %s", (p) => expect(isPricesPath(p, "/api/")).toBe(true));
  it.each(["/api/", "/api", "/api/prices-apiX", "/api/prices", "/api/x402-facilitator/", "/api/anything"])(
    "boots the hub for %s", (p) => expect(isPricesPath(p, "/api/")).toBe(false));
  it("follows another base", () => expect(isPricesPath("/api/next/prices-api/", "/api/next/")).toBe(true));
});
// and: with window.name === "stellar-portal-oauth" and window.opener set, importing boot posts
// {source: "stellar-portal-oauth", search} to the opener and mounts nothing in #root.
```

`test/base-path.test.ts` (hub's build tests), changed: "asks for every file under the prefix" ignores exactly `https://www.googletagmanager.com/ns.html?id=GTM-TBF2GP5S` and `//js.hs-scripts.com/8102665.js`; "names no other host" allows exactly the hosts `www.googletagmanager.com` and `js.hs-scripts.com` and still fails on any other; a new case asserts the built `index.html` contains the consent default (`analytics_storage:'denied'` before the GTM loader) and `GTM-TBF2GP5S`. `src/prices/consent-mode.spec.ts` reads `join(import.meta.dirname, '..', '..', 'index.html')`. `src/prices/main.spec.tsx` pushes `/api/prices-api/` and imports `./main`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test`
Expected: FAIL on the missing `boot.js` and the analytics assertions.

- [ ] **Step 3: Write `index.html`**

Hub's current head (charset, viewport, `<title>Soroban Scan APIs</title>`) plus, from source `web/portal/index.html` at the same positions: the consent-mode inline script, the GTM loader, the GTM `<noscript>` iframe, the HubSpot loader and its consent listener; the three favicon links pointing at `/src/prices/assets/…` so Vite fingerprints them under `/api/assets/`. No robots meta (the hub's `noindexOutsideApi` plugin owns it). No HTML comments (there is no comment-stripping plugin here). `<script type="module" src="/src/boot.js">`.

- [ ] **Step 4: Write `boot.js`, the two entries and the base path**

`src/hub/main.tsx`: what `src/main.tsx` does today. `src/prices/main.tsx`: the source's `main.tsx` minus the popup bridge (boot runs it) — `StrictMode`, `ThemeProvider`, `CssBaseline`, `BrowserRouter basename={ROUTER_BASENAME}`, `App`, `import './theme/fonts.css'`. Today the Prices page's title and `noindex` come from its own `index.html`; keep both by rendering `<title>Stellar Prices API — API keys</title>` and `<meta name="robots" content="noindex" />` once at the top of the Prices `App` (React 19 hoists them into `<head>`).

- [ ] **Step 5: Run the checks**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all pass; `dist/assets/` has separate chunks for the hub and Prices entries, MUI only in the Prices side (check `dist/assets/*.js` names and sizes, list them in the report).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: boot the hub or the Prices portal from one index.html"
```

---

### Task 3: Dev server like Prices', README, and a look

**Files:**
- Modify: `vite.config.ts`, `.gitignore`, `README.md`
- Create: `src/prices/dev-proxy.spec.ts` (from source, against this repo's `vite.config.ts`)

**Interfaces:**
- Produces, in `vite.config.ts`: exported `devProxy(target: string | undefined, apiKey: string | undefined)` returning Vite's `server.proxy` object, used for `server.proxy` and `preview.proxy`; read with `loadEnv(mode, process.cwd(), "")` (`DEV_API_PROXY_TARGET`, `DEV_API_KEY`), never exposed to the bundle.

- [ ] **Step 1: Write the failing test**

`src/prices/dev-proxy.spec.ts` from the source, importing `devProxy` from `../../vite.config.ts` (or calling the config as the source does): the rule `^/api/(auth|key|usage|config|api-docs-json)(/|\?|$)` plus `/v1`, `/health`, `/api-docs-json`; it matches the backend paths and not `/api/`, `/api/prices-api/…`, `/api/assets/…`, `/api/login`; `x-api-key` only on `/v1`; no proxy when the target is unset.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test src/prices/dev-proxy.spec.ts`
Expected: FAIL, `devProxy` not exported.

- [ ] **Step 3: Implement the proxy, `.gitignore`, README**

Port the source's proxy (`vite.config.mts` lines 52–148) into `devProxy`. `.gitignore` adds `.env*.local` and `.env.development`. README: the Prices portal's place in the repo, `VITE_PORTAL_API_ORIGIN` for builds, `DEV_API_PROXY_TARGET` (and that signing in locally needs Prices' backend run locally, as its own README says), that `web/portal` in stellar-prices-api stays the deployed copy until the switch.

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: serve the Prices portal on the dev server as Prices does"
```

- [ ] **Step 6: Look at it (controller, in a browser)**

`DEV_API_PROXY_TARGET=https://prices-api.sorobanscan.com pnpm dev`, then `http://localhost:5173/api/prices-api/` beside `https://sorobanscan.com/api/prices-api/` at desktop width: landing, `/docs`, `/quick-start`, `/privacy-policy`, `/login` alike; `/api/` still the hub with its own fonts; "Explore Prices API" on the hub opens the Prices landing; no hub styles on Prices pages and the reverse (computed `font-family` of `body` on each). Signing in is not expected to complete locally (the backend sends Discord's answer to production).
