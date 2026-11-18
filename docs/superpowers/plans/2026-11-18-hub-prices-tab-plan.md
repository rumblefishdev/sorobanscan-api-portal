# Hub Prices Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed in on `pnpm dev`, the dashboard's Prices tab shows the developer's real Prices key, usage and rate limit from production, issues a key on "Get API Key" and revokes it, through the hub's backend and Prices' new contract.

**Architecture:** The BFF signs a 60-second HMAC token per call with a secret from AWS Secrets Manager (locally read through the developer's AWS credentials) and calls Prices' `/api/hub/v1/*` server-to-server. The page calls only the BFF (`/api/hub/prices/*`). "Get API Key" is a form `POST` that starts a silent Discord round trip bound to the session; the callback checks the gates and asks Prices to issue.

**Tech Stack:** Hono, `@aws-sdk/client-secrets-manager`, `node:crypto`, React 19 + MUI (Prices' components), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-shared-sign-in-design.md` (decisions 4, 6, 11–16 — decision 15 is the token format with a test vector; "Getting a key", "The token the BFF gives products", "The dashboard contract", "Found in review of the local sign-in"). Prices' side: `docs/superpowers/plans/2026-11-18-prices-hub-contract-plan.md`.

## Global Constraints

- Token: `v1.<payload>.<mac>` as the spec's decision 15 (HMAC-SHA256 with context `sorobanscan-hub/prices-token/v1`), claims `iss` `https://sorobanscan.com/api/hub`, `aud` `prices`, `sub` `discord:<id>`, `name`, `iat`, `exp = iat + 60`, `jti` (random 16 bytes, base64url), `act` ∈ `read`/`reveal`/`revoke`/`issue`, one token per Prices call, signed with the secret's `current`. The spec's test vector is a unit test here.
- Settings (added to the BFF's): `HUB_PRICES_TOKEN_SECRET` (Secrets Manager name, default `sorobanscan-hub/production/prices-token`, region `eu-central-1`; read through the SDK's default credentials, cached 5 minutes, never logged), `PRICES_HUB_API` (default `https://prices-api.sorobanscan.com/api/hub/v1`), `HUB_PRODUCTS` (comma list, default `prices`; the BFF's own allowlist), `MIN_ACCOUNT_AGE_MINUTES` (default 5). AWS credentials come from the SDK's default chain (`AWS_PROFILE` locally). If the secret can't be read (no credentials, no access, malformed), `/api/hub/prices/*` answers 503 `{"error":"product_not_configured"}`; sign-in keeps working.
- BFF routes (all need a session; none answers 403/404 for its own decisions): `GET /api/hub/prices/account`, `POST /api/hub/prices/key/reveal`, `POST /api/hub/prices/key/revoke`, `POST /api/hub/auth/issue` (form, `product=prices`). No session → 401 `{"error":"not_signed_in"}`; product not in `HUB_PRODUCTS` → 400 `{"error":"unknown_product"}`; every `POST` needs the page's `Origin` (400 otherwise).
- Issue flow: `POST /api/hub/auth/issue` with a session → 303 to Discord (`prompt=none`), `action=issue` and `product` signed into both halves; at the callback the Discord id must equal the session's, else `issue=account_mismatch`; gates: member, not pending, account age ≥ `MIN_ACCOUNT_AGE_MINUTES`; passed → Prices `key/issue` with `act=issue`; the browser lands on `/api/dashboard/prices?issue=<issued|has_key|capped|too_young|not_member|pending_rules|unknown|failed|account_mismatch|cancelled>`.
- Calls to Prices: 20 s timeout, one retry on 503; a gateway 429 (`{"message":"Too Many Requests"}`) → 503 `{"error":"prices_busy"}`; Prices' error codes passed through as `{"error":<code>}`.
- Logs: `discord:<id>` on key events, `jti`; never a token, key value or secret.
- The page: the Prices tab reproduces the Prices portal's dashboard (key card with show/copy and revoke after a second click, Get API Key, usage meter, rate limit, the cap notice), built from `src/prices/landing/DashboardPanel.tsx` parts; `?issue=` read once, in Prices' words where Prices has them.
- Never read `.env.local`; never commit AWS account ids beyond what the repo already has; no `Co-Authored-By`; never push without akot.

## Review Focus

1. A forged or replayed form `POST` from another site to `/api/hub/auth/issue`: refused (Origin), no Discord round trip. Pinned in Task 3.
2. A visitor who switched Discord accounts between sign-in and "Get API Key": `account_mismatch`, no Prices call. Pinned in Task 3.
3. Secrets Manager unreachable or AWS credentials expired locally: `/api/hub/prices/*` answers 503 with a reason the tab shows; sign-in unaffected. Pinned in Tasks 1–2.
4. `/me` failing or slow: the dashboard shows "Could not check your sign-in status" with a retry, not the login card. Pinned in Task 4.
5. Prices answers HTML or a non-envelope 429: mapped to `prices_busy`/`prices_unavailable`, never shown raw. Pinned in Task 2.

---

### Task 1: The shared secret and the token signer

**Files:** Create `bff/src/token.ts`, `bff/src/product-secret.ts`, `bff/test/token.test.ts`; modify `bff/src/settings.ts`, `package.json`, `README.md`.

**Interfaces:**
- `productSecret(name, client?): () => Promise<Buffer>` (GetSecretValue, parse `{"current"}`, 32 bytes, cache 5 min, failures not cached for more than 10 s).
- `mintToken(secret: Buffer, { discordId, name, act, now, jti? }): string`.

- [ ] Tests first: the spec's test vector (fixed `now`, `jti`) gives exactly the spec's token; claims exact; `productSecret` with a fake client (parse cases, cache, failure retry); the secret never appears in logs or errors. Implement; README: the setting, local use through `AWS_PROFILE`, and the one-time command for akot to create the secret (`aws secretsmanager create-secret --name sorobanscan-hub/production/prices-token --region eu-central-1 --secret-string "{\"current\":\"$(openssl rand -base64 32)\"}"`). Commit `feat: sign product tokens with the shared secret`.

### Task 2: The Prices proxy routes

**Files:** Create `bff/src/products/prices.ts`, `bff/test/prices.test.ts`; modify `bff/src/app.ts`.

**Interfaces:** `pricesClient({ api, signer, fetchImpl?, now? })` with `account(caller)`, `reveal(caller)`, `revoke(caller)`, `issue(caller)`; `requireSession` middleware (401). Routes as in the constraints.

- [ ] Tests first against a fake Prices (verifies the bearer token with a test secret, records calls): one token per call with the right `act`; 401 without a session and no Prices call; `unknown_product`; Origin on POSTs; timeout/retry; 429/HTML mapping; logs. Implement; commit `feat: proxy the Prices tab through the hub's backend`.

### Task 3: "Get API Key"

**Files:** Modify `bff/src/app.ts`, `bff/src/discord.ts` (account age from the snowflake), tests.

- [ ] Tests first: the issue flow end to end with the fake Discord and fake Prices (each `issue=` outcome; Review Focus 1–2; `prompt=none`; `action`/`product` in both signed halves; a sign-in callback can't be turned into an issue and the reverse). Implement; commit `feat: issue a Prices key from the hub's dashboard`.

### Task 4: The Prices tab

**Files:** Create `src/account/prices/*.tsx`, specs; modify `src/account/session.ts` (`failed` state, 10 s timeout, retry), `DashboardPage.tsx` (`/dashboard/<unknown or off>` → `replace` to the first enabled tab).

- [ ] Tests first (fetch stubbed): no key → "Get API Key" form posting to `/api/hub/auth/issue`; active key → masked value, Show/Copy (reveal call), revoke after a second click, usage meter and rate limit from `details`; revoked + capped → the cap notice with the date; each `?issue=` banner in Prices' words; `failed` session state; errors from the BFF in words. Implement; commit `feat: the Prices tab with the real key and usage`.

### Task 5: End to end (controller with akot)

- [ ] After the secret exists and Prices' contract is deployed: `AWS_PROFILE=<akot's> pnpm dev`; signed in, the Prices tab shows akot's key and usage as `sorobanscan.com/api/prices-api/dashboard` does; Show/Copy work; "Get API Key" is tried only on an account without a key; revoke last or with a second Discord account (decision 14).
