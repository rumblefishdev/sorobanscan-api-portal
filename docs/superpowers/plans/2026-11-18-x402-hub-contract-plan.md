# x402's Hub Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stellar-x402's `apps/portal` answers the hub's four-call contract on the existing registry, with no sign-in of its own, as one rebuilt pull request (#194).

**Architecture:** A new branch from `origin/develop` carries the old branch's registry package and sealed store unchanged (two cherry-picks), then `apps/portal` written as the contract's backend (the old branch's `config`, `logger`, `rate-limit`, `seal`, `server`, `main` reused), then deploy, the page and docs. The token, the cap and the answers copy Prices' contract (`~/Projects/stellar-prices-api/docs/runbooks/hub-contract.md`).

**Tech Stack:** Node 22, TypeScript, Express 5, pg, Vitest; pnpm through `corepack pnpm`; Compose and systemd units under `deploy/`.

**Spec:** stellar-x402 `lore/1-tasks/active/0106_FEATURE_api-key-portal-discord.md`, "The hub's contract" and decisions 23-33; this repo's `docs/superpowers/specs/2026-11-17-shared-sign-in-design.md`, "The token the BFF gives products", decision 15, and "x402 joins".

## Global Constraints

- Repo: `~/Projects/stellar-x402`. Old work: branch `lore-0106-api-key-portal-discord` (call it `OLD`). New branch: `lore-0106-hub-contract`, from `origin/develop`, in a worktree at `~/Projects/stellar-x402/.claude/worktrees/0106-hub` (on disk; never under `/tmp`, which is RAM).
- **Never push, never force-push, never open or edit a pull request.** akot does that.
- Commits: `feat(lore-0106): …` / `refactor(lore-0106): …` / `docs(lore-0106): …`, Conventional Commits, no AI attribution, no `Co-Authored-By`. Linear history: no merge commits.
- `export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH`; pnpm is `corepack pnpm`. Root `pnpm test`/`typecheck` go through turbo, which needs a real `pnpm` binary: `corepack enable --install-directory <dir>/bin pnpm` into a directory on disk, then put it on `PATH`. After creating the worktree: `corepack pnpm install --frozen-lockfile`.
- Tests use the compose PostgreSQL at `127.0.0.1:15432` (already running). `docker` is not usable from the session.
- Lint only changed paths (root `pnpm lint` reports ~900 errors from a git-ignored directory). `settle.test.ts`'s "settle budget (ADR 0011)" can fail once in the full parallel run and passes alone (task 0074): not a regression.
- A test lives in its package's `test/` as `*.test.ts`.
- Token: `v1.<payload>.<mac>`; `mac` = base64url(HMAC-SHA256(secret, `sorobanscan-hub/x402-token/v1` ‖ 0x00 ‖ ASCII(payload))); `iss` `https://sorobanscan.com/api/hub`; `aud` `x402`; `sub` `discord:<snowflake>` (`^[0-9]{1,20}$`); leeway 5 s; lifetime at most 60 s; `act` one of `read`, `reveal`, `revoke`, `issue`.
- Logs carry `jti`, `act`, the outcome and `key_id`; never the token, a key, a secret, the Discord id or the username.
- Errors are `{"code", "message"}` (`details` only for `key_revoked`). Every answer under `/api` is `Cache-Control: no-store`. No `Access-Control-*` header anywhere.
- Docs and comments: plain English, in the repo's voice (short sentences, says what is so).

## Review Focus

1. A token signed for Prices (`aud: "prices"`, Prices' context) presented here: `401 invalid_token`, not accepted. (Task 3)
2. A revoke at 23:59:59 UTC on a month's last day and an issue one second later: issued, not capped; a revoke at exactly 00:00:00 on the 1st caps that month. (Task 4)
3. An account whose key was issued by the operator's script (no sealed copy), or whose copy doesn't open: `account` says `showable: false`, `reveal` answers `409 key_not_viewable`, revoke still works. (Task 5)
4. The database out of reach during a call: `503 key_unavailable` for `account`, `reveal`, `revoke`; `200 {"outcome":"failed"}` for `issue`; nothing about the database in the body. (Task 5)
5. One member calling often must not shut out another: 61 verified calls from account A in a minute are refused from the 61st, while account B from the same address is answered; unverified calls from that address being limited doesn't limit either. (Task 5)

---

### Task 1: The branch, with the registry package and the sealed store

**Files:** none written by hand; two cherry-picks.

**Interfaces:**
- Produces: `@stellar-x402/api-keys` exporting `ApiKeyStore`, `PostgresApiKeyStore`, `SealedKeyStore`, `PostgresSealedKeyStore`, `OwnerKeys`, `OwnedKey`, `newApiKey`, `apiKeyHash`, `isApiKey`; `@stellar-x402/api-keys/testing` (the in-memory store and the contract tests); the facilitator's migration `0014_api_key_copies`.

- [ ] **Step 1:** `git -C ~/Projects/stellar-x402 fetch origin`, then `git worktree add .claude/worktrees/0106-hub -b lore-0106-hub-contract origin/develop`. Check `.claude/worktrees` is git-ignored; if not, add it to `.git/info/exclude` (not to `.gitignore`).
- [ ] **Step 2:** In the worktree: `git cherry-pick bf770614` ("move the API key registry to a package"). Resolve conflicts in favour of develop's current code with the move applied; `pnpm-lock.yaml` conflicts are resolved by taking develop's and running `corepack pnpm install` (commit the lockfile as part of the pick).
- [ ] **Step 3:** `git cherry-pick 94aea2b4` ("keep a sealed copy of each key the portal issues"). If `origin/develop` gained a migration after `0013_api_keys`, renumber this one after it and say so in the report (on 2026-11-18 it had none).
- [ ] **Step 4:** Verify. Run `corepack pnpm --filter @stellar-x402/api-keys test` and `corepack pnpm --filter @stellar-x402/facilitator test` and the root `typecheck`. Expected: all pass (the facilitator runs the sealed store's contract on PostgreSQL). Each commit must build on its own: check out the first pick alone and run the same two commands.

Commit messages stay the originals'.

### Task 2: `apps/portal` without a sign-in: settings and the secret

**Files:**
- Create (from `OLD` with `git checkout lore-0106-api-key-portal-discord -- <path>`): `apps/portal/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/logger.ts`, `src/rate-limit.ts`, `src/seal.ts`, `src/server.ts`, `src/config.ts`, `test/config.test.ts`, `test/units.test.ts`
- Modify: `apps/portal/src/config.ts`, `apps/portal/test/config.test.ts`, `apps/portal/test/units.test.ts` (drop the cases of modules not carried: cookies, tokens, eligibility's membership), `apps/portal/package.json` (`description`: "The portal's backend: a seller's pubnet API key, for the API hub")
- Not carried from `OLD`: `src/discord.ts`, `src/cookies.ts`, `src/tokens.ts`, `src/app.ts`, `src/main.ts`, `test/app.test.ts`, `test/discord.test.ts`, `test/portal.ts` (Tasks 5 and 6 write the new `app.ts`, `main.ts` and their tests).

**Interfaces:**
- Produces, in `src/config.ts`:

```ts
export interface HubSecret { current: Buffer; previous?: Buffer }
export interface Config {
  port: number;
  /** The hub's token secret (decision 23). Never logged. */
  hubSecret: HubSecret;
  keyEncryptionKey: Buffer;
  databaseUrl: string;
  minAccountAgeMinutes: number;      // MIN_ACCOUNT_AGE_MINUTES, default 5, 0..525600
  clientIp: "socket" | "cloudflare";
  logLevel: LogLevel;
}
export function parseHubSecret(text: string): HubSecret | undefined;
```

- Settings: `PORT` (4022), `DATABASE_URL`, `KEY_ENCRYPTION_KEY`, `HUB_TOKEN_SECRET`, each of the last three also as `<NAME>_FILE` (`FILE_SETTINGS`); `MIN_ACCOUNT_AGE_MINUTES`, `CLIENT_IP`, `LOG_LEVEL`. Gone: `PUBLIC_URL`, `WEB_URL`, `DISCORD_*`, `SESSION_SECRET`.

- [ ] **Step 1: Failing tests** in `test/config.test.ts`:
  - `HUB_TOKEN_SECRET` `{"current":"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA="}` parses to a 32-byte `current`, no `previous`; with a `previous` of the same form, both.
  - Refused with the problem `HUB_TOKEN_SECRET must be JSON {"current", "previous"?}, each standard padded base64 of 32 bytes`, and the message never repeats the value: not JSON; a JSON array; a key other than `current`/`previous`; `current` missing; a 31- or 33-byte value; base64url or unpadded base64 (Prices' rule: `^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$`).
  - `HUB_TOKEN_SECRET is required` when absent; `HUB_TOKEN_SECRET_FILE` read from a file, trailing newline tolerated.
  - `current` or `previous` equal to `KEY_ENCRYPTION_KEY`: `HUB_TOKEN_SECRET and KEY_ENCRYPTION_KEY must differ`.
  - A config with `DISCORD_CLIENT_ID`, `SESSION_SECRET`, `PUBLIC_URL` or `WEB_URL` set is accepted and ignores them (an old `.env` must not stop a start).
- [ ] **Step 2:** Run `corepack pnpm --filter @stellar-x402/portal test`; expected: the new cases fail.
- [ ] **Step 3:** Implement `parseHubSecret` and the new `Config`/`parseConfig` in `src/config.ts`.
- [ ] **Step 4:** Run the package's tests and `typecheck` (it will fail on the missing `main.ts` import in `server.ts`: add a `src/main.ts` that only exports `main` throwing `new Error("not built yet")`, replaced in Task 6). Expected: tests pass, typecheck passes.
- [ ] **Step 5:** No commit yet: Tasks 2-6 are one commit (see Task 6).

### Task 3: The hub's token

**Files:**
- Create: `apps/portal/src/hub-token.ts`, `apps/portal/test/hub-token.test.ts`

**Interfaces:**
- Consumes: `HubSecret` (Task 2).
- Produces:

```ts
export const ACTS = ["read", "reveal", "revoke", "issue"] as const;
export type Act = (typeof ACTS)[number];
export interface HubCaller { discordId: string; jti: string; act: Act }
/** The caller a token names, or `undefined` for any token that isn't the hub's for x402, now. */
export function verifyHubToken(token: string, secret: HubSecret, nowMs: number): HubCaller | undefined;
/** For tests and the runbook's probe only: a token as the hub signs one. */
export function signHubToken(secret: Buffer, claims: Record<string, unknown>): string;
```

- [ ] **Step 1: Failing tests** in `test/hub-token.test.ts`:
  - **The pinned vector** (the hub pins the same one): secret base64 `AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=`, claims exactly `{"iss":"https://sorobanscan.com/api/hub","aud":"x402","sub":"discord:80351110224678912","name":"nelly","iat":1795000000,"exp":1795000060,"jti":"AAECAwQFBgcICQoLDA0ODw","act":"reveal"}`, token
    `v1.eyJpc3MiOiJodHRwczovL3Nvcm9iYW5zY2FuLmNvbS9hcGkvaHViIiwiYXVkIjoieDQwMiIsInN1YiI6ImRpc2NvcmQ6ODAzNTExMTAyMjQ2Nzg5MTIiLCJuYW1lIjoibmVsbHkiLCJpYXQiOjE3OTUwMDAwMDAsImV4cCI6MTc5NTAwMDA2MCwianRpIjoiQUFFQ0F3UUZCZ2NJQ1FvTERBME9EdyIsImFjdCI6InJldmVhbCJ9.mpP3cY6Kclck-SvWeTU6bYt9xnTiVNmx91xl6L1Qkho`.
    At `nowMs = 1795000030000` it verifies to `{discordId: "80351110224678912", jti: "AAECAwQFBgcICQoLDA0ODw", act: "reveal"}`.
  - Prices' own vector (the spec's decision 15 token, `aud: "prices"`) is refused (Review Focus 1); so is a token with `aud: "x402"` signed under Prices' context.
  - Accepted under `previous` when `current` is another key; refused under neither.
  - Refused, each `undefined`: no `v1.` prefix; two or four parts; a payload that isn't base64url of JSON, or isn't an object; a MAC of the wrong length; one bit of the MAC or payload changed; `iss` other; `sub` `discord:abc`, `discord:`, `operator:x`, 21 digits; `act` `admin` or missing; `jti` not a non-empty string of at most 64 characters; `iat`/`exp` not integers; `exp <= now − 5 s`; `iat > now + 5 s`; `exp − iat > 60`; `exp < iat`; a token longer than 2048 characters (refused before any HMAC).
  - Accepted at the edges: `exp = now − 4 s`; `iat = now + 5 s`.
- [ ] **Step 2:** Run; expected: fail, the module is missing.
- [ ] **Step 3:** Implement. The MAC is compared with `timingSafeEqual` against both keys' MACs, both computed whatever the first says; the claims are parsed only after the MAC holds.
- [ ] **Step 4:** Run; expected: pass.

### Task 4: The month cap and the account's age

**Files:**
- Create: `apps/portal/src/cap.ts`, `apps/portal/test/cap.test.ts`
- Create: `apps/portal/src/eligibility.ts` (new content; `OLD`'s is the model), cases in `apps/portal/test/units.test.ts`

**Interfaces:**
- Produces:

```ts
// cap.ts
/** RFC 3339 in whole seconds, UTC: "2026-12-01T00:00:00Z". */
export function rfc3339(ms: number): string;
/** Whether a key revoked at `lastRevokedAt` (ms) still holds back a new one at `nowMs` (decision 24). */
export function capOf(lastRevokedAt: number | undefined, nowMs: number):
  | { capped: false }
  | { capped: true; nextEligibleAt: string };

// eligibility.ts
export function accountCreatedMs(id: string): number | undefined;   // as in OLD
export function accountAge(id: string, minAccountAgeMinutes: number, nowMs: number):
  | { kind: "old_enough" }
  | { kind: "too_young"; oldEnoughAt: string }   // rfc3339, rounded up to a whole second
  | undefined;                                    // not a snowflake
```

- [ ] **Step 1: Failing tests.** `cap.test.ts`, Prices' cases (`keys/cap.rs`) on milliseconds:
  - Revoked 2026-08-03T14:30:00Z: capped with `nextEligibleAt` `2026-09-01T00:00:00Z` at any instant of 3, 4, 20 and 31 August; not capped on 1 and 30 September.
  - Revoked minutes before `now`, same month: capped.
  - Revoked at exactly 2026-08-01T00:00:00.000Z, now 15 August: capped. Revoked at 2026-07-31T23:59:59.999Z, now 2026-08-01T00:00:00.000Z: not capped (Review Focus 2).
  - December: revoked 2026-12-10, `nextEligibleAt` `2027-01-01T00:00:00Z`.
  - `undefined` (never revoked): not capped.
  - `accountAge`: an id made 4 minutes before `now` with a minimum of 5 is `too_young` with `oldEnoughAt` one minute on; 5 minutes old exactly is `old_enough`; minimum 0 is always `old_enough`; `"abc"` is `undefined`.
- [ ] **Step 2:** Run; expected: fail.
- [ ] **Step 3:** Implement. The month's start is `Date.UTC(year, month, 1)` of `nowMs`; capped when `lastRevokedAt >= start`.
- [ ] **Step 4:** Run; expected: pass.

### Task 5: The four routes

**Files:**
- Create: `apps/portal/src/app.ts`, `apps/portal/test/app.test.ts`, `apps/portal/test/portal.ts` (the test's harness: the app on the in-memory `SealedKeyStore` from `@stellar-x402/api-keys/testing`, a fixed clock, a log collector, `token(act, overrides?)` built on `signHubToken`)

**Interfaces:**
- Consumes: `verifyHubToken`, `HubCaller`, `Act` (Task 3); `capOf`, `rfc3339`, `accountAge` (Task 4); `Config` (Task 2); `SealedKeyStore`, `newApiKey`, `apiKeyHash` (Task 1); `Sealer` (`seal.ts`: `seal(key, owner, hash): Buffer`, `open(sealed, owner, hash): string | undefined`); `rateLimiter`; `Logger`.
- Produces:

```ts
export const STRANGER_LIMIT_PER_MINUTE = 30;   // per address, calls whose token doesn't verify
export const ACCOUNT_LIMIT_PER_MINUTE = 60;    // per token's account, calls whose token does
export interface AppDeps {
  config: Pick<Config, "hubSecret" | "minAccountAgeMinutes" | "clientIp">;
  keys: SealedKeyStore; sealer: Sealer; logger: Logger;
  ready: () => Promise<void>;
  now?: () => number;
}
export function createApp(deps: AppDeps): Express;
```

**The contract** (owner is `discord:<id>`; `key_id` is the hash's first 12 hex digits; times are `rfc3339`):

| Route | `act` | Answers |
|---|---|---|
| `GET /api/hub/v1/account` | `read` | `200 {"key": {...}, "details": {"showable": bool}}` |
| `POST /api/hub/v1/key/reveal` | `reveal` | `200 {"key_id","value","created_at"}`; `404 no_key`; `404 key_revoked` with `details {next_eligible_at, revoked_at}` while the cap holds (revoked in an earlier month: `404 no_key`); `409 key_not_viewable` |
| `POST /api/hub/v1/key/revoke` | `revoke` | `200 {"revoked": true, "revoked_at", "next_eligible_at"}`; `404 no_key` |
| `POST /api/hub/v1/key/issue` | `issue` | always `200 {"outcome", "next_eligible_at"?}` |

`key` in `account`: `{"state":"none","can_issue":true}`; `{"state":"active","key_id","created_at","can_issue":false}`; revoked this month `{"state":"revoked","revoked_at","next_eligible_at","can_issue":false}`; revoked earlier `{"state":"revoked","revoked_at","can_issue":true}`. `details.showable` is true only for an active key whose copy opens.

`issue`, in this order: the account's age (`too_young` with `next_eligible_at` = `oldEnoughAt`; an id with no age is `401 invalid_token`); `keysOf`; an active key → `has_key`; `capOf(lastRevokedAt)` → `capped` with `next_eligible_at`; `keys.issue` (`false`, lost to a concurrent issue → `has_key`) → `issued`; anything thrown → `failed`, logged at error.

On every route, first: no bearer or `verifyHubToken` is `undefined` → the address's stranger limiter, then `401 invalid_token` (or `429 rate_limited` with `Retry-After` once over); a good token for another `act` → `403 action_not_allowed`; then the account's limiter (`429 rate_limited`). The address is `CF-Connecting-IP` when `clientIp` is `cloudflare`, else the socket's. A store failure on `account`, `reveal`, `revoke` → `503 key_unavailable`. Other paths `404 not_found`; an unhandled error `500 internal`. `/health` as in `OLD` (`200 {"ready":true}`, `503 {"ready":false}`), outside the token and the limits. Headers on `/api`: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

Log events (`logger.<level>(event, {jti, act, outcome?, key_id?})`): `hub_account_answered` (info, with `state`), `hub_key_issued`, `hub_key_revoked`, `hub_key_revealed` (info), `hub_issue_refused` (info: `too_young`, `capped`, `has_key`), `hub_reveal_refused`/`hub_revoke_refused` (info: `no_key`, `key_revoked`, `key_not_viewable`), `hub_key_copy_unreadable` (error, a copy that exists and doesn't open), `hub_call_refused` (warn, with `reason`: `invalid_token` or `action_not_allowed`; debug when no bearer was sent), `hub_call_failed` (error, with `error`).

- [ ] **Step 1: Failing tests** in `test/app.test.ts`, one `describe` per route plus one for the gate:
  - Gate: each route without a bearer, with a malformed one, with Prices' vector → `401 {"code":"invalid_token","message":…}` and the store is never read; each route with each other route's `act` → `403 action_not_allowed`; a `GET` on a `POST` route and the reverse → `404 not_found`; no answer carries `Access-Control-Allow-Origin` even with an `Origin` header; every `/api` answer is `no-store`.
  - `account`: the four `key` shapes above, exactly (`toEqual`), with `showable` true for a sealed key; a key issued without a copy and one sealed under another key → `active`, `showable: false` (Review Focus 3).
  - `reveal`: returns the very key that was issued; `404 no_key` for an account never seen; `404 key_revoked` with both instants this month; `404 no_key` when revoked last month; `409 key_not_viewable` for both unshowable kinds, and only the copy that doesn't open logs `hub_key_copy_unreadable`.
  - `revoke`: `200` with `revoked_at` = now and `next_eligible_at` = the next month's start, after which `ownerOf(hash)` on the store is `undefined` and the copy is gone; `404 no_key` on a second revoke; works for an unshowable key.
  - `issue`: `issued` and the store holds an active key whose copy opens to a key `isApiKey` accepts; again → `has_key`, nothing new stored; revoked this month → `capped` with `next_eligible_at`; revoked last month → `issued`; an account one minute old → `too_young` with `next_eligible_at` four minutes on and the store never read; two concurrent issues → one `issued`, one `has_key`.
  - Store throwing: `503 key_unavailable` on `account`, `reveal`, `revoke`; `200 {"outcome":"failed"}` on `issue`; no body holds the error's message (Review Focus 4).
  - Limits (Review Focus 5): 60 `account` calls from account A pass and the 61st is `429` with `Retry-After`, while account B, same address, is answered; 30 bad tokens from one address get `401` and the 31st `429`, after which a good token from that address is still answered; the window ends after 60 s of the fixed clock.
  - Logs: across a run of every outcome above, no log line holds the token, the key's value, the secret's base64, the Discord id or `nelly`; each key event holds `jti`, `act` and `key_id`.
- [ ] **Step 2:** Run; expected: fail, `app.ts` is missing.
- [ ] **Step 3:** Implement `createApp`. No body parser: the `POST`s carry none.
- [ ] **Step 4:** Run the package's tests; expected: pass.
- [ ] **Step 5: Removal check.** Remove in turn, run, see a test fail, put back: the `act` check; the `previous` key; the cap in `issue`; the stranger limiter; the account limiter. Report which test failed for each.

### Task 6: Start-up, and the commit

**Files:**
- Create: `apps/portal/src/main.ts` (from `OLD`, without Discord, tokens, `publicUrl`/`webUrl`), `apps/portal/README.md` (rewritten: what the backend is, the contract's table and errors, what is kept, the settings, how to run it locally against a scratch schema)
- Modify: `apps/portal/src/server.ts` only if it names removed settings

- [ ] **Step 1:** `main.ts`: `parseConfig`, the pool as in `OLD` (comment: "A call holds one connection for a moment"), the two-table check, `createApp`, the same keep-alive and shutdown. The `listening` log line carries `port` only.
- [ ] **Step 2: Run by hand** on a scratch schema of the local database (`127.0.0.1:15432`), as `OLD`'s notes did: without the tables it refuses to start, naming them; after the facilitator's migrations `/health` answers 200; `curl` without a bearer → `401 invalid_token`; with `Authorization: Bearer v1.probe.probe` → `401`; a token minted with `signHubToken` and the local secret for a 2015 Discord id walks `account` (none) → `issue` (issued) → `account` (active) → `reveal` → `revoke` → `issue` (capped); `SIGTERM` exits 0. Without `HUB_TOKEN_SECRET` it refuses to start, naming the setting. Put the transcript (keys and tokens cut out) in the report.
- [ ] **Step 3:** Root `typecheck`, the package's tests, `eslint` and `prettier --check` on `apps/portal`.
- [ ] **Step 4: Commit** Tasks 2-6 as one: `feat(lore-0106): answer the hub's contract from the portal's backend`. The body says: the four routes, the token (`aud`, context, one `act` per call), the cap, the limits, and that there is no sign-in here.

### Task 7: Image and deploy

**Files (from `OLD`, then changed):** `apps/portal/Dockerfile`, `deploy/production/portal.compose.yaml`, `deploy/production/deploy-portal.sh`, the `x402-portal@`/`x402-portal-deploy@` units and `x402-portal-deploy`/`x402-portal-compose` under `deploy/`, `.github/workflows/deploy-portal-production.yml`, the playbook's entries and `deploy/ansible/files/deploy-portal-production.pub`, the CloudWatch agent's config entries, `deploy/scripts/check-production-portal.sh`, `deploy/test/portal.test.ts`, the facilitator workflow's path filter. Find them all with `git diff --stat origin/develop...lore-0106-api-key-portal-discord -- deploy .github apps/portal/Dockerfile`.

- [ ] **Step 1:** Check the files out from `OLD` (commits `cb269a33`, `2f5bbf8c`; cherry-pick if they apply cleanly, else checkout by path).
- [ ] **Step 2:** In `portal.compose.yaml`: remove `PUBLIC_URL`, `WEB_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET_FILE`, `SESSION_SECRET_FILE`, the secrets `portal-discord-client-secret` and `portal-session-secret`, and the header's `PORTAL_DISCORD_CLIENT_ID`; add `HUB_TOKEN_SECRET_FILE: /run/secrets/portal-hub-token-secret` and the secret `portal-hub-token-secret` (file `${SECRETS_DIR:-/run/x402/production}/portal-hub-token-secret`). The header says who calls the service now (the hub's backend, through the tunnel) and that it calls nobody but the database. Follow every other place the removed names occur (`grep -rn "discord-client-secret\|session-secret\|PORTAL_DISCORD" deploy docs .github`): the credentials' list the units decrypt, the playbook, the check script, the tests.
- [ ] **Step 3:** `deploy/test/portal.test.ts` and `check-production-portal.sh`: the secrets are the three that remain; the script's "sign-in redirect" probe becomes the contract's: `/api/hub/v1/account` without a bearer answers `401 invalid_token`.
- [ ] **Step 4:** Run `corepack pnpm --filter ./deploy test` (or the workspace name `deploy/package.json` gives), `systemd-analyze verify` on both units if available, and `bash -n` on the changed scripts. Expected: pass.
- [ ] **Step 5: Commit:** `feat(lore-0106): add the portal backend's image and deploy`.

### Task 8: The page without a sign-in

**Files (from `OLD`):** `apps/portal-web/**` at `OLD`'s tip, then:
- Delete: `src/Login.tsx`, `src/Dashboard.tsx`, `src/api.ts`, `src/oauth-popup.ts`, `test/dashboard.test.tsx`, `test/no-backend.test.tsx`, `test/popup.test.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`, the sections with a "Get API Key" (`grep -rn "Get API Key\|/login\|/dashboard\|VITE_PORTAL_API_ORIGIN" apps/portal-web`), `test/app.test.tsx`, `package.json` (drop `react-router` if nothing else uses it), any `.env.example`/README naming `VITE_PORTAL_API_ORIGIN`

**Interfaces:**
- Produces: `export const HUB_SIGN_IN = "https://sorobanscan.com/api/login?from=x402";` (in `src/base-path.ts` or a `src/hub.ts`).

- [ ] **Step 1: Failing tests** in `test/app.test.tsx`: every link or button named "Get API Key" is an `<a>` whose `href` is exactly `https://sorobanscan.com/api/login?from=x402`; the key card names no route of this page; the page renders at `/api/x402-facilitator/login` and `/dashboard` as the landing page (an unknown address shows the landing page, as before). `test/base-path.test.ts` stays as it is and must pass.
- [ ] **Step 2:** Run `corepack pnpm --filter @stellar-x402/portal-web test`; expected: the new cases fail.
- [ ] **Step 3:** Make the change; remove dead styles of the deleted views from `styles.css`.
- [ ] **Step 4:** Run the package's tests, `typecheck` and `build`; expected: pass, and `grep -r "x402-portal\|VITE_PORTAL_API_ORIGIN" apps/portal-web/dist apps/portal-web/src` finds nothing.
- [ ] **Step 5: Commit:** `feat(lore-0106): add the portal's page, with its keys in the API hub`.

### Task 9: Docs and the task

**Files:**
- Modify: `docs/runbook.md` ("The portal's backend"), `docs/threat-model.md`, `docs/adr/0012-facilitator-state-store.md`, `apps/facilitator/README.md`, `lore/1-tasks/active/0106_FEATURE_api-key-portal-discord.md`

- [ ] **Step 1: `docs/runbook.md`**, "The portal's backend" (start from `OLD`'s `174f3584`): what it is now; the role `x402_portal` (unchanged `GRANT`s); the three credentials and how each is made, `portal-hub-token-secret` being the JSON copied by an admin from Secrets Manager (`aws secretsmanager get-secret-value --profile stellar --region eu-central-1 --secret-id sorobanscan-hub/production/x402-token --query SecretString --output text`, piped into the credentials' own tool, never echoed); creating the secret (one `create-secret` command, as the hub's README has Prices'); **changing it in four steps**, Prices' (`~/Projects/stellar-prices-api/docs/runbooks/hub-contract.md` §1) with `SECRET_ID=sorobanscan-hub/production/x402-token` and, in place of the Lambda's recycle, "copy the stored JSON to the server's credential and `systemctl restart x402-portal@production`", in the same order and with the same waits; the checks after a deploy (the two `curl` probes and what `401` means); the log events and which to act on; Cloudflare (Browser Integrity Check off for the host, no challenge, no per-address limit that counts the hub as one caller).
- [ ] **Step 2:** `docs/threat-model.md`, ADR 0012 and `apps/facilitator/README.md`: wherever they say only a key's hash is kept, add the portal's sealed copy (AES-256-GCM under `KEY_ENCRYPTION_KEY`, bound to the owner and the hash, in `api_key_copies`, deleted on revoke, readable by the portal only through the key, decision 18's caveat). In the threat model add the hub's token as a trust boundary: who holds the secret can issue a key for any Discord account; the secret is in Secrets Manager and in one file on the server.
- [ ] **Step 3: The task file.** Carry the worktree's copy up to date with the main checkout's uncommitted edits of 2026-11-18 (the file moved to `active/`, "The hub's contract", decisions 23-33: copy the file from `~/Projects/stellar-x402/lore/1-tasks/active/` and `git rm` the `blocked/` one). Add Implementation Notes for what Tasks 1-8 built and checked (test counts, the hand run, the removal checks), and mark as superseded the notes about the removed sign-in. Leave the acceptance criteria unchecked: nothing is deployed.
- [ ] **Step 4:** `prettier --check` on the changed files; `corepack pnpm test` at the root. Expected: pass (but for 0074's known flake).
- [ ] **Step 5: Commit:** `docs(lore-0106): describe the hub's contract and the key's sealed copy`.

### Task 10: What akot runs

**Files:**
- Create: `~/Projects/sorobanscan-api-portal/.superpowers/sdd/2026-11-18-x402-hub-contract-plan/akot-steps.md` (not committed)

- [ ] **Step 1:** Write the commands, in order, each with what it should print, none run: (1) `aws secretsmanager create-secret --profile stellar --region eu-central-1 --name sorobanscan-hub/production/x402-token --secret-string "{\"current\":\"$(openssl rand -base64 32)\"}"` and the copy to the server's credential, by the runbook; (2) the Browser Integrity Check change for `x402-portal.sorobanscan.com` in `soroban-infrastructure` (`cloudflare/x402.tf`: read how the facilitator's host turns it off, write the same for this host and fix the comment that says its clients are browsers; a local branch and commit there, not pushed); (3) the facilitator's deploy, which runs `0014`; (4) the role `x402_portal`, from the runbook; (5) the first `production-portal` deploy, approved by someone other than akot; (6) the end-to-end test from a local hub, as Prices' was (revoke last, or on a second account: it caps the month); and the force-push of `lore-0106-hub-contract` onto `lore-0106-api-key-portal-discord` with #194's new description (drafted here from the commits, by the repo's `pr` skill's house style).
