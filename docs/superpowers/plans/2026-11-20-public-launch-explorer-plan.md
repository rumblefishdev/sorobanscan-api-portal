# The hub's public start: the explorer's distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `soroban-block-explorer`'s CloudFront distribution can hand `/api/hub/*` to the hub's backend and everything else under `/api/` to the hub's bundle, each by a setting, and builds exactly what it builds today with neither set.

**Architecture:** One pull request in `soroban-block-explorer`, infrastructure only. A new optional setting, `apiHub`, arms two stages: its presence adds the backend's behaviour; its `pages: true` replaces the behaviours under `/api` with the hub's. One new CloudFront Function answers every page address. The hub's side is `2026-11-20-public-launch-hub-plan.md` in `sorobanscan-api-portal`; neither plan depends on the other's code.

**Tech Stack:** AWS CDK v2 (TypeScript), CloudFront Functions (JavaScript runtime 2.0, written as template strings), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-public-launch-design.md` in `rumblefishdev/sorobanscan-api-portal` (branch `docs/public-launch-design` until it is merged). Its section "The explorer's distribution" and its three tables of addresses are what this plan builds.

## Global Constraints

- This repo's own rules come first: its `CLAUDE.md`, a lore task before any code, its branch and commit forms (`feat/NNNN_slug`, `feat(lore-NNNN): …`), tests in `__tests__/` beside the code, no `rm`, a production module under about 800 lines. `infra/src/lib/stacks/delivery-stack.ts` is 631 lines: it must not grow by more than the calls into the new files.
- Base branch: `develop`, fetched fresh. The local checkout in `~/Projects/soroban-block-explorer` is far behind; work in a new worktree from `origin/develop`.
- With no `apiHub` in an environment's settings, the synthesized template of that environment is the one `origin/develop` synthesizes. `infra/envs/production.json` and `infra/envs/testnet.json` are not changed by this pull request.
- Nothing under `web/` or `libs/` changes: the explorer has no link to `/api/`, and its "Prices API" link is a plain anchor already.
- The header's secret is never a literal: the template holds a `{{resolve:secretsmanager:…}}` reference.
- The names the hub's function knows, in this order: `login`, `dashboard`, `quick-start`, `docs`, `privacy-policy`, `prices-api`.
- Never push, and never open a pull request, without akot's word.

## Review Focus

- A release of the explorer between this merge and the start: production's `/api/` must not change. Task 2's "neither" case.
- The way back from the start: turning `pages` off must give today's behaviours and functions back. Task 3's "both, then pages off" case.
- `/api/hub` with no slash matches no `/api/hub/*`: it must answer as an unknown address, not reach the backend or the bundle. Task 1.
- A viewer who sends `X-Hub-Viewer-Ip` or `X-Hub-Origin-Secret` of their own: the backend must receive CloudFront's values. Task 2.
- A page address whose last segment holds a `.` (`/api/docs/prices/v1.2`): it goes to the bucket and gets the explorer's page, which the spec accepts; it must not answer a redirect loop or a `5xx`. Task 1.

---

### Task 0: The task and the branch

- [ ] **Step 1:** In a new worktree from `origin/develop`, follow the repo's `CLAUDE.md`: create the lore task with its tooling ("Hand `/api/` to the API hub, by a setting", linking the spec), and the branch `feat/NNNN_api-hub-routing`.
- [ ] **Step 2:** Run the repo's install and `infra`'s tests once, unchanged, and note the passing count. Expected: all pass.

### Task 1: The hub's routing function

**Files:**
- Create: `infra/src/lib/cloudfront-functions/api-hub-routing.ts`
- Test: `infra/src/lib/cloudfront-functions/__tests__/api-hub-routing.test.ts`

**Interfaces:**
- Consumes: `HostMove`, `legacyHostSnippet`, `MOVED_JS` from `legacy-host-redirect.ts`.
- Produces: `API_HUB_PAGES`, the six names as a `const` tuple, and `apiHubRoutingFunctionCode(move: HostMove | undefined): string`, the source of a viewer-request function with a `handler(event)`.

- [ ] **Step 1: Write the failing test**, running the source as `api-hub-redirect.test.ts` runs its own (`new Function(code + "; return handler;")`). A redirect is `{statusCode, headers.location.value}`; a pass is the request, with its `uri`.

```ts
// → the bundle's page
it.each(["/api/", "/api/login", "/api/login/", "/api/dashboard", "/api/dashboard/x402",
  "/api/quick-start/prices", "/api/docs/x402", "/api/docs/prices/anything",
  "/api/privacy-policy", "/api/prices-api/", "/api/prices-api/login"])
  ("%s is the hub's page", (uri) => expect(pass(uri).uri).toBe("/api/index.html"));

// → a file, as asked
it.each(["/api/docs/x402/openapi.json", "/api/prices-api/openapi.json", "/api/docs/prices/v1.2"])
  ("%s goes to the bucket", (uri) => expect(pass(uri).uri).toBe(uri));

// → 301
["/api", "/api/"], ["/api/prices-api", "/api/prices-api/"],
["/api/openapi.json", "/api/prices-api/openapi.json"]      // its query kept: ?x=1 → …?x=1

// → 302 to /api/, with no query
"/api/x402-facilitator", "/api/x402-facilitator/", "/api/x402-facilitator/dashboard",
"/api/foo", "/api/foo.js", "/api/loginx", "/api/hub", "/api/LOGIN", "/api//login"
```

  And: the query of a page address is not touched (`/api/login?signin=busy` keeps its `querystring`); with `move = {from: "sorobanscan.rumblefish.dev", to: "sorobanscan.com"}` and that `Host`, `/api/login?from=prices` answers `301` to `https://sorobanscan.com/api/login?from=prices` and `/api/foo` answers `302` to `https://sorobanscan.com/api/`, each in one hop, while the new host's answers are those above; `API_HUB_PAGES` is the six names.
- [ ] **Step 2: Run** `pnpm vitest run infra/src/lib/cloudfront-functions/__tests__/api-hub-routing.test.ts` (or the repo's own way to run one infra test). Expected: fail, no such module.
- [ ] **Step 3: Implement.** In order: the old host's move; bare `/api` and bare `/api/prices-api` get their slash, in the same hop as a host move; then the first segment after `/api/`: none or one of `API_HUB_PAGES` is a page (a last segment with a `.` is left as it is, anything else becomes `/api/index.html`), `openapi.json` is the `301`, anything else the `302`. ES5-style source, as the sibling functions are written.
- [ ] **Step 4: Run** the same command. Expected: pass.
- [ ] **Step 5: Commit** `feat(lore-NNNN): add the API hub's routing function`.

### Task 2: The setting, and the backend's behaviour

**Files:**
- Create: `infra/src/lib/stacks/api-hub-behaviors.ts`, `infra/src/__tests__/api-hub-behaviors.test.ts`
- Modify: `infra/src/lib/types.ts`, `infra/src/lib/stacks/delivery-stack.ts`

**Interfaces:**
- Produces, in `EnvironmentConfig`:

```ts
readonly apiHub?: {
  /** The backend's Lambda function URL host, with no scheme and no path. */
  readonly backendHost: string;
  /** In Secrets Manager: JSON whose `current` CloudFront sends as `X-Hub-Origin-Secret`. */
  readonly originSecretName: string;
  /** Raised after the secret's value changed: CloudFormation reads a reference again only when the template changes. */
  readonly originSecretRevision: string;
  /** The start: the hub's bundle serves `/api/` and the pages under it (task 3). */
  readonly pages: boolean;
};
```

- Produces, in `api-hub-behaviors.ts`: `apiHubBackendBehavior(scope, config, shared): cloudfront.BehaviorOptions`, where `shared` carries what the stack already has (the response-headers policy). Task 3 adds the pages' behaviours to this file.

- [ ] **Step 1: Write the failing test**, synthesizing the Delivery stack as `api-portal-behaviors.test.ts` does, from production's settings with `apiHub` added or not:
  - **Neither** (no `apiHub`), for production and for testnet: the `Explorer-<env>-Delivery` template equals the one synthesized before this change. Pin it with the list of path patterns in order and each `/api*` behaviour's function name, as that existing test reads them.
  - **The backend** (`apiHub` with `pages: false`): the patterns are today's, with `/api/hub/*` before `/api/*`. Its origin's domain is `backendHost`, HTTPS only, with a read timeout of 30 s and two custom headers: `X-Hub-Origin-Secret`, whose value in the template contains `{{resolve:secretsmanager:` and `originSecretName` and `:SecretString:current`, and `X-Hub-Origin-Revision`, the setting. Its cache policy is the managed `CachingDisabled`; it allows all seven methods; `ViewerProtocolPolicy` is `https-only`. Its viewer-request function (`api-hub-backend-headers.ts`, `<env>-soroban-explorer-api-hub-backend-headers`) sets `x-hub-viewer-ip` to `event.viewer.ip`, replacing a viewer's own, and deletes a viewer's `x-hub-origin-secret` and `x-hub-origin-revision`; its own test covers each, an IPv6 viewer too. Its origin request policy forwards every cookie, every query string, and exactly the headers `Origin`, `Content-Type`, `Accept`, `X-Hub-Viewer-Ip`.
  - A different `originSecretRevision` gives a different template.
- [ ] **Step 2: Run** the test. Expected: fail.
- [ ] **Step 3: Implement.** The behaviour in the new file (`origins.HttpOrigin`, the secret by `Secret.fromSecretNameV2(...).secretValueFromJson("current").unsafeUnwrap()`, as `compute-stack.ts` takes its own); `delivery-stack.ts` adds it, only with `apiHub`, above `/api/*`. Extend the stack's header comment by one bullet.
- [ ] **Step 4: Write the finding in the lore task's notes:** an origin's custom header replaces a viewer's header of the same name (AWS's guide, "Add custom headers to origin requests"); the guide doesn't say the same of `CloudFront-Viewer-Address`, so the client's address travels in `X-Hub-Viewer-Ip`, written by the function from `event.viewer.ip`, as AWS's own example function writes `True-Client-IP`.
- [ ] **Step 5: Run** the infra tests. Expected: pass, the count of task 0 plus the new ones.
- [ ] **Step 6: Commit** `feat(lore-NNNN): add the API hub's backend behaviour, by a setting`.

### Task 3: The pages

**Files:**
- Modify: `infra/src/lib/stacks/api-hub-behaviors.ts`, `infra/src/lib/stacks/delivery-stack.ts`, `infra/src/__tests__/api-hub-behaviors.test.ts`

**Interfaces:**
- Consumes: `apiHubRoutingFunctionCode` (task 1), `apiHub.pages` (task 2).
- Produces: `apiHubPageBehaviors(scope, config, shared): Record<string, cloudfront.BehaviorOptions>`, the behaviours under `/api` when `pages` is on.

- [ ] **Step 1: Write the failing tests**, in the same file:
  - **Both** (`apiHub` with `pages: true`): the patterns under `/api` are exactly `/api/hub/*`, `/api/assets/*`, `/api/prices-api`, `/api/prices-api/*`, `/api`, `/api/*`, with `/api/*` last of them; there is no `/api/x402-facilitator`, no `/api/x402-facilitator/*` and no `/api/`. The patterns outside `/api` (`/assets/*`, `/static/*`, `/prices-api*`, `/pricing-api*`) are today's.
  - `/api`, `/api/*`, `/api/prices-api` and `/api/prices-api/*` run one function, named `<env>-soroban-explorer-api-hub-routing`, whose source holds the six names; their origin is the API SPA bucket's.
  - `/api/assets/*` has the bucket's origin, the managed `CachingOptimized` policy and no function.
  - The two `prices-api` behaviours' response-headers policy adds `X-Robots-Tag: noindex` and has every security header of the stack's shared policy; no other behaviour's policy has `X-Robots-Tag`.
  - The template has no function named `…-x402-portal-routing`, `…-api-spa-routing` or `…-api-hub-redirect`, and still has `…-api-path-redirect`.
  - **Both, then pages off:** the template equals the backend-only one of task 2.
  - `pages: true` with `pricesPortalOnLegacyHost: true` stops the synth with a message naming both settings.
- [ ] **Step 2: Run** the test. Expected: fail.
- [ ] **Step 3: Implement.** `apiHubPageBehaviors` in the new file; in `delivery-stack.ts`, the block of behaviours under `/api` and the three functions only it uses are built when `pages` is off, and the new ones when it is on. The shared response-headers policy's settings move into one object both policies are built from, so the `noindex` one can't drift from it. The stack's header comment says what `/api` is in each of the three states.
- [ ] **Step 4: Run** the infra tests and the repo's type check and lint. Expected: pass.
- [ ] **Step 5: Synthesize by hand, three times** (neither, the backend, both), with a made-up `backendHost`, and compare each with `origin/develop`'s production template using `cdk diff`-style output or `diff` on the JSON. Expected: neither, no difference; the backend, one origin, one policy and one behaviour added; both, the changes of step 1 and nothing outside `/api`. Paste the three summaries in the lore task's notes.
- [ ] **Step 6: Commit** `feat(lore-NNNN): serve /api/ from the API hub's bundle, by a setting`.

### Task 4: The notes and the pull request

- [ ] **Step 1:** In the lore task: what the setting does in each state, that `infra/envs/production.json` is changed only at the deployment (two pull requests then, per the hub's `docs/runbook.md`: first `apiHub` with `pages: false`, later `pages: true`), the way back, and what is left for a clean-up after the start (`ApiHubPage` and its route, `enableX402PortalBasicAuth`, the unarmed path, the bucket's `api/x402-facilitator/`, the KeyValueStore's `auth-token-x402`).
- [ ] **Step 2:** Run everything the repo's CI runs for `infra`. Expected: pass.
- [ ] **Step 3:** With akot's word: push and open the pull request to `develop`, in the repo's form, saying in its first lines that it changes nothing on production until a setting is added.
