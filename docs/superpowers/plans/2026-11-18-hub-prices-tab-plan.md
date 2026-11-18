# Hub Prices Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed in on `pnpm dev`, the dashboard's Prices tab shows the developer's real Prices key, usage and rate limit from production, issues a key on "Get API Key" and revokes it, through the hub's backend and Prices' new contract.

**Architecture:** The BFF signs a 60-second ES256 token per call with an AWS KMS key (locally through the developer's AWS credentials) and calls Prices' `/api/hub/v1/*` server-to-server. The page calls only the BFF (`/api/hub/prices/*`). "Get API Key" is a form `POST` that starts a silent Discord round trip bound to the session; the callback checks the gates and asks Prices to issue. The KMS key lives in a small CDK app in this repo.

**Tech Stack:** Hono, `@aws-sdk/client-kms`, AWS CDK v2 (TypeScript), React 19 + MUI (Prices' components), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-shared-sign-in-design.md` (decisions 4, 6, 11–14; "Getting a key", "The token the BFF gives products", "The dashboard contract", "Found in review of the local sign-in"). Prices' side: `docs/superpowers/plans/2026-11-18-prices-hub-contract-plan.md`.

## Global Constraints

- Token: ES256, header `{alg:"ES256",typ:"JWT",kid}`, claims `iss` `https://sorobanscan.com/api/hub`, `aud` `prices`, `sub` `discord:<id>`, `name`, `iat`, `exp = iat + 60`, `jti` (random 16 bytes, base64url), `act` ∈ `read`/`reveal`/`revoke`/`issue`, one token per Prices call. Signed by KMS key alias `alias/sorobanscan-hub-token` (ECC_NIST_P256, SIGN_VERIFY) in `eu-central-1`; `kid` = the key's id. The BFF publishes the public key at `GET /api/hub/jwks.json`.
- Settings (added to the BFF's): `HUB_TOKEN_KMS_KEY` (alias or ARN), `PRICES_HUB_API` (default `https://prices-api.sorobanscan.com/api/hub/v1`), `HUB_PRODUCTS` (comma list, default `prices`; the BFF's own allowlist), `MIN_ACCOUNT_AGE_MINUTES` (default 5). AWS credentials come from the SDK's default chain (`AWS_PROFILE` locally). Without a KMS key setting, `/api/hub/prices/*` answers 503 `{"error":"product_not_configured"}`; sign-in keeps working.
- BFF routes (all need a session; none answers 403/404 for its own decisions): `GET /api/hub/prices/account`, `POST /api/hub/prices/key/reveal`, `POST /api/hub/prices/key/revoke`, `POST /api/hub/auth/issue` (form, `product=prices`). No session → 401 `{"error":"not_signed_in"}`; product not in `HUB_PRODUCTS` → 400 `{"error":"unknown_product"}`; every `POST` needs the page's `Origin` (400 otherwise).
- Issue flow: `POST /api/hub/auth/issue` with a session → 303 to Discord (`prompt=none`), `action=issue` and `product` signed into both halves; at the callback the Discord id must equal the session's, else `issue=account_mismatch`; gates: member, not pending, account age ≥ `MIN_ACCOUNT_AGE_MINUTES`; passed → Prices `key/issue` with `act=issue`; the browser lands on `/api/dashboard/prices?issue=<issued|has_key|capped|too_young|not_member|pending_rules|unknown|failed|account_mismatch|cancelled>`.
- Calls to Prices: 20 s timeout, one retry on 503; a gateway 429 (`{"message":"Too Many Requests"}`) → 503 `{"error":"prices_busy"}`; Prices' error codes passed through as `{"error":<code>}`.
- Logs: `discord:<id>` on key events, `jti`; never a token, key value or secret.
- The page: the Prices tab reproduces the Prices portal's dashboard (key card with show/copy and revoke after a second click, Get API Key, usage meter, rate limit, the cap notice), built from `src/prices/landing/DashboardPanel.tsx` parts; `?issue=` read once, in Prices' words where Prices has them.
- Never read `.env.local`; never commit AWS account ids beyond what the repo already has; no `Co-Authored-By`; never push without akot.

## Review Focus

1. A forged or replayed form `POST` from another site to `/api/hub/auth/issue`: refused (Origin), no Discord round trip. Pinned in Task 3.
2. A visitor who switched Discord accounts between sign-in and "Get API Key": `account_mismatch`, no Prices call. Pinned in Task 3.
3. KMS unreachable or AWS credentials expired locally: `/api/hub/prices/*` answers 503 with a reason the tab shows; sign-in unaffected. Pinned in Tasks 1–2.
4. `/me` failing or slow: the dashboard shows "Could not check your sign-in status" with a retry, not the login card. Pinned in Task 4.
5. Prices answers HTML or a non-envelope 429: mapped to `prices_busy`/`prices_unavailable`, never shown raw. Pinned in Task 2.

---

### Task 1: The KMS key and the token signer

**Files:** Create `infra/` (CDK app: `bin/hub.ts`, `lib/token-key-stack.ts`, `cdk.json`, tests), `bff/src/token.ts`, `bff/test/token.test.ts`; modify `bff/src/settings.ts`, `bff/src/app.ts` (`/jwks.json`), `package.json`, `README.md`.

**Interfaces:**
- Stack `SorobanscanHubTokenKey` (env `eu-central-1`): `kms.Key` ECC_NIST_P256 SIGN_VERIFY, alias `alias/sorobanscan-hub-token`, removal policy RETAIN, key policy allowing the account's administrators (the Lambda's grant comes in stage 3); output the key id.
- `interface TokenSigner { kid: string; publicJwk(): Promise<JsonWebKey>; sign(claims: TokenClaims): Promise<string> }`, `kmsSigner(keyId, client?)` (KMS `Sign` with `MessageType: "RAW"`, `ECDSA_SHA_256`, DER → 64-byte r‖s), `localSigner(privateKey)` for tests only.
- `mintToken(signer, { discordId, name, act, now })`.

- [ ] Tests first: a token from `localSigner` verifies with `crypto.subtle` under its JWK; DER→JOSE conversion for r/s with leading zeros; claims and header exact; `/api/hub/jwks.json` serves the public JWK (`kty`,`crv`,`x`,`y`,`kid`,`use: "sig"`,`alg: "ES256"`); CDK snapshot/assertions (key spec, usage, alias, retain). Implement; commit `feat: sign product tokens with a KMS key`. akot deploys the stack (`pnpm cdk deploy SorobanscanHubTokenKey` with his profile) and seeds Prices' `/prices/production/hub-jwt-public-keys` from `jwks.json`.

### Task 2: The Prices proxy routes

**Files:** Create `bff/src/products/prices.ts`, `bff/test/prices.test.ts`; modify `bff/src/app.ts`.

**Interfaces:** `pricesClient({ api, signer, fetchImpl?, now? })` with `account(caller)`, `reveal(caller)`, `revoke(caller)`, `issue(caller)`; `requireSession` middleware (401). Routes as in the constraints.

- [ ] Tests first against a fake Prices (verifies the bearer token with the test JWK, records calls): one token per call with the right `act`; 401 without a session and no Prices call; `unknown_product`; Origin on POSTs; timeout/retry; 429/HTML mapping; logs. Implement; commit `feat: proxy the Prices tab through the hub's backend`.

### Task 3: "Get API Key"

**Files:** Modify `bff/src/app.ts`, `bff/src/discord.ts` (account age from the snowflake), tests.

- [ ] Tests first: the issue flow end to end with the fake Discord and fake Prices (each `issue=` outcome; Review Focus 1–2; `prompt=none`; `action`/`product` in both signed halves; a sign-in callback can't be turned into an issue and the reverse). Implement; commit `feat: issue a Prices key from the hub's dashboard`.

### Task 4: The Prices tab

**Files:** Create `src/account/prices/*.tsx`, specs; modify `src/account/session.ts` (`failed` state, 10 s timeout, retry), `DashboardPage.tsx` (`/dashboard/<unknown or off>` → `replace` to the first enabled tab).

- [ ] Tests first (fetch stubbed): no key → "Get API Key" form posting to `/api/hub/auth/issue`; active key → masked value, Show/Copy (reveal call), revoke after a second click, usage meter and rate limit from `details`; revoked + capped → the cap notice with the date; each `?issue=` banner in Prices' words; `failed` session state; errors from the BFF in words. Implement; commit `feat: the Prices tab with the real key and usage`.

### Task 5: End to end (controller with akot)

- [ ] After Prices' contract is deployed and the JWKS seeded: `AWS_PROFILE=<akot's> pnpm dev`; signed in, the Prices tab shows akot's key and usage as `sorobanscan.com/api/prices-api/dashboard` does; Show/Copy work; "Get API Key" is tried only on an account without a key; revoke last or with a second Discord account (decision 14).
