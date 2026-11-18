# Prices Hub Contract Implementation Plan (stellar-prices-api)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prices' API Lambda answers four calls from the hub's backend, authorised by a 60-second HMAC-signed token instead of the portal's session cookie, reusing Prices' own key, cap and usage logic, so the hub's Prices tab can show, issue and revoke a developer's real key.

**Architecture:** A `portal/hub/` module in `packages/prices-api`: a pure HMAC token verifier (the `hmac`/`sha2` crates and the constant-time compare the session code already uses), the shared secret from Secrets Manager, a bearer extractor, and four handlers mounted inside the `PORTAL_ENABLED` gate and outside the portal's CORS layer. The handlers call service functions extracted (without behaviour change) from today's key and usage handlers.

**Tech Stack:** Rust, axum, `hmac` 0.12 + `sha2` (already direct dependencies), the existing `Gateway` and its loopback mock for tests.

**Spec:** `docs/superpowers/specs/2026-11-17-shared-sign-in-design.md` in `rumblefishdev/sorobanscan-api-portal` ("The dashboard contract", decisions 11–16 — decision 15 is the token format with a test vector, "Found in review of the local sign-in").

**Repo:** `/home/fish/Projects/stellar-prices-api`, from `origin/develop` (`057986e2` when planned). Its rules bind: root and `lore/` `CLAUDE.md` (no code without an active task; never any AI attribution in commits or PRs; never `rm`, move to `.trash/`), `.claude/skills/branch` and `pr`.

## Global Constraints

- Lore task **0348** (pull `develop` first; take the next free id if 0348 is gone), type FEATURE, created and activated on `develop` as the repo's rules say; branch `feat/0348_hub-dashboard-contract`; commits `feat(lore-0348): …`, `refactor(lore-0348): …`, `docs(lore-0348): …`; PRs to `develop`, titled `refactor(0348): …` and `feat(0348): …`, one `## Summary` of bullets.
- Paths: `GET /api/hub/v1/account`, `POST /api/hub/v1/key/reveal`, `POST /api/hub/v1/key/revoke`, `POST /api/hub/v1/key/issue`. Mounted through `portal::apply_with`, never in the OpenAPI document.
- Token: `v1.<payload>.<mac>` exactly as the spec's decision 15 (context `sorobanscan-hub/prices-token/v1`, HMAC-SHA256, base64url without padding); claims `iss` = `https://sorobanscan.com/api/hub` and `aud` = `prices` (compiled-in constants), `sub` = `discord:<snowflake>`, `name`, `iat`, `exp`, `jti`, `act`. The spec's test vector is a unit test here. Accepted when the MAC verifies (constant time) under `current` or `previous`, `exp > now - 5 s`, `iat <= now + 5 s`, `exp - iat <= 60 s`, `sub` is `discord:` + a snowflake, and `act` is the one the route needs: `read` for `account`, `reveal` for reveal, `revoke` for revoke, `issue` for issue.
- A missing, malformed or refused token answers 401 `{"code":"invalid_token","message":…}` before any control-plane call; a token whose `act` doesn't fit the route answers 403 `{"code":"action_not_allowed"}`; contract not configured (no hub keys) answers 503 `{"code":"hub_unconfigured"}`. Every answer `Cache-Control: no-store`.
- Secret: Secrets Manager `sorobanscan-hub/production/prices-token`, JSON `{"current","previous"?}` (base64, 32 bytes each), operator-created, read through the extension like the OAuth secret (`extension::secret_string`); Lambda env `PORTAL_HUB_SECRET_NAME`; local seam `PORTAL_HUB_SECRET` (inline JSON) compiled out of the Lambda. Redacted `Debug`. A bad or missing secret closes only the contract (503 `hub_unconfigured`), never the portal.
- Prices' own rules apply unchanged: one active key per account (`discord-<id>-key`), the month cap after a revoke, the plan resolution, `ManagedBy=prices-portal` on every key; hub-issued keys get `IssuedBy=hub-contract`.
- Issue re-checks the account's age from the snowflake (minimum from the existing SSM setting) as a backstop; membership and screening are the hub's proof (`act=issue`), recorded as an amendment to ADR 0010 §8.
- Logs: `jti`, `act`, outcome, `key_id`; never the token, the key, the Discord id or the username.
- Today's portal routes keep behaving exactly as before (their tests unchanged and green).

## Review Focus

1. A token MACed with another secret, a version other than `v1`, a truncated or re-encoded payload (padding, standard base64), or an expired / too-long-lived token: 401, no AWS call. Pinned in Task 2.
2. A `read` token sent to `key/revoke` or `key/issue`: 403, no AWS call. Pinned in Task 3.
3. A secret that fails to load or parse: the contract says 503, `/api/config` and the portal still work. Pinned in Task 2.
4. Gateway or deadline failures on the contract map to the same 502/503 codes the portal uses, with no stack or token in the body. Pinned in Task 3.
5. After a hub revoke or issue, the same Lambda's usage cache for that account is invalidated (no stale "no key" for 60 s on the next `account`). Pinned in Task 3.

---

### Task 1: Extract the service functions (no behaviour change) — PR 1

**Files:** Modify `packages/prices-api/src/portal/keys/mod.rs`, `usage/mod.rs`, `keys/gateway.rs`; tests stay as they are, plus unit tests for the new functions.

**Interfaces (produced, `pub(crate)`):**
- `keys::key_state(gateway: &Gateway, discord_id: &str, deadline: Duration) -> Result<KeyState, KeyError>` where `KeyState = None | Active{record, value} | Revoked{revoked_at, next_eligible_at: Option<String>}` (the cap decision now inside it, as `reveal` does it today).
- `keys::revoke_for(gateway, discord_id, deadline) -> Result<RevokeOutcome, KeyError>` (`disable_all` + `next_eligible_at`, as `revoke` does).
- `keys::issue_for(gateway, sub, deadline, issued_by: &str) -> IssueOutcome` with `Capped{next_eligible_date, next_eligible_at}`.
- `Gateway::create(name, issued_by)`; today's callers pass `"task-0187"`.
- `UsageState::answer_for(&self, gateway, discord_id) -> UsageOutcome` (cache, fetch, throttle fallback, deadline — what `usage()` does), `UsageResponse`/`PlanWire`/`KeyResponse`/`RevokeResponse`/`rfc3339`/`no_store` exposed `pub(crate)`.
- Today's handlers call these; their observable behaviour (status, JSON, logs, AWS calls) is unchanged.

- [ ] Steps: create and activate task 0348 on `develop` (ask akot before pushing to `develop`); branch; refactor in small commits (move, then extract); `cargo fmt --all -- --check`, `cargo clippy -p prices-api -- -D warnings`, `cargo test -p prices-api` all green with the existing portal tests untouched; commit `refactor(lore-0348): extract the portal's key and usage services`.

### Task 2: Verify the hub's token, load the shared secret

**Files:** Create `src/portal/hub/{mod.rs,token.rs,secret.rs}`; modify `config.rs` (`hub_secret_from_env`), `sources.rs` (`Loaded.hub`, loaded beside but not inside the fatal `try_join!`).

**Interfaces:**
- `token::verify(token: &str, secret: &HubSecret, now: SystemTime) -> Option<HubCaller>`; `HubCaller { discord_id: String, act: Act, jti: String }`; `Act = Read | Reveal | Revoke | Issue`. No distinction between refusal reasons in the result (as `auth/crypto.rs` does).
- `secret::HubSecret::parse(json: &str) -> Result<HubSecret, SecretError>` (`current` required, `previous` optional, each exactly 32 bytes after base64; redacted `Debug`).

- [ ] Tests first (unit): the spec's test vector verifies (at `now` = 1795000030) and fails one second after `exp` + leeway; MAC under `previous` accepted; each Review Focus 1 case; `exp - iat > 60`; `sub` not `discord:`+snowflake; `iss`/`aud` wrong; secret parse cases; sources: secret absent → contract unconfigured while `/api/config` stays enabled. Then implement; commit `feat(lore-0348): verify the hub's signed tokens`.

### Task 3: The four routes

**Files:** Create `src/portal/hub/{auth.rs,account.rs,key.rs}`; modify `portal/mod.rs` (merge `hub::routes` inside the gate, outside `cors_layer`), `tests/portal_hub.rs` (via `#[path = "portal_keys/harness.rs"]`), `tests/portal_hub_logs.rs`.

**Interfaces (JSON):**
- `GET account` → `{"key": {"state": "none"|"active"|"revoked", "key_id"?, "created_at"?, "last_updated_at"?, "revoked_at"?, "next_eligible_at"?, "can_issue": bool}, "details": {"usage": <UsageResponse>|null, "free_rate_limit_per_second": n|null}}` from one listing under one deadline (reveal's lookup and usage share it; the 15 s Lambda budget holds).
- `POST key/reveal` → `{"key_id","name","value","created_at","last_updated_at"}` or 404 `no_key` / `key_revoked` as today.
- `POST key/revoke` → `RevokeResponse` as today.
- `POST key/issue` → `{"outcome":"issued"|"has_key"|"capped"|"too_young"|"failed","next_eligible_at"?}`; age backstop first; `issue_for(..., "hub-contract")`; usage cache invalidated on issued/revoked.

- [ ] Tests first against the mock gateway: each route's happy path; Review Focus 2, 4, 5; no AWS call on a bad token (`list_calls == 0`); `no-store` everywhere; no CORS headers; a log test that no token, key value, Discord id or username is printed. Then implement; commit `feat(lore-0348): answer the hub's dashboard contract`.

### Task 4: Infrastructure, runbook, ADR — PR 2

**Files:** Modify `infra/src/lib/stacks/compute-stack.ts` (env `PORTAL_HUB_SECRET_NAME`, statement `PortalReadHubTokenSecret`: `secretsmanager:GetSecretValue` on that one secret), CI check 7 if it pins env names; `docs/runbooks/` (the secret: who creates it, its JSON, changing it through `previous`; the BFF's calls must pass Cloudflare's rules from task 0340); `lore/2-adrs/0010_…` (amendment: membership and screening proved by the hub for hub-issued keys; age re-checked here); the task file.

- [ ] `npm run infra:synth:production` and the infra tests green; `cargo test --workspace`, clippy, fmt; open the two PRs (refactor, then contract) with the `pr` skill — ask akot before pushing and opening them; reviewers per the repo's rule.
- [ ] Deploy is akot's: the secret exists (the hub plan's Task 1 gives the command), `make -C infra deploy-production-compute`.
