/**
 * Every off-page destination the landing page names, in one place.
 *
 * Centralised so that a destination that does not exist yet cannot hide: the
 * quick start and the API reference were both placeholders aliased to the raw
 * OpenAPI document until their pages landed (task 0193 for the quick start's
 * page, task 0195 for Swagger UI), and every "Swagger UI" affordance on the
 * landing page went through this file rather than through a literal. Task
 * 0163's curl-by-curl walkthrough is still owed to the quick start's snippets.
 *
 * All root-relative and all under `/api/prices-api/`, because on the shared host
 * the root belongs to the block explorer (task 0194): a link to
 * `/api-docs-json` there opens the explorer's page, not the document.
 */

import { API_ORIGIN } from '../api-origin';
import { ROUTER_BASENAME } from '../base-path';

/**
 * The public base of the data API, `/v1` included — what every snippet on the
 * landing and the quick start tells a reader to call.
 *
 * The API's own hostname (task 0194), not the execute-api origin the pages
 * carried until 2026-08-31. A literal rather than something derived from
 * `API_ORIGIN`: that value is empty on every build but the shared-host one,
 * and a snippet must name the same host wherever the page is served from.
 * `links.spec.ts` asserts it equals `apiBaseUrl` in
 * `infra/envs/production.json` — the value the OpenAPI `servers` block
 * advertises — so a reader following the quick start and a reader following
 * the spec are sent to the same place.
 */
export const PUBLIC_API_BASE_URL = 'https://prices-api.sorobanscan.com/v1';

/**
 * The OpenAPI document itself — the raw JSON, linked beside the rendered
 * reference for generators and other tooling.
 *
 * Same-origin, the alias under the portal prefix (`portal::OPENAPI_PATH` in
 * the API), not the root `/api-docs-json` that partners and the spec's
 * `servers` block use — the two are the same bytes from the same handler. On
 * the shared host (task 0194) the alias is no backend path: `/api/*` there is
 * a `301` into this static SPA (explorer task 0660), so this points at the
 * root copy on the API's own hostname instead.
 *
 * ⚠️ This is also what `docs/ApiReference.tsx` **fetches**, cross-origin, to
 * render the reference — which is why `GET /api-docs-json` answers
 * `Access-Control-Allow-Origin: *` (see `packages/prices-api/src/lib.rs`).
 * Opened by navigation it would need no such header; opened by `fetch` it
 * does, so the two must stay in step.
 */
export const OPENAPI_JSON = API_ORIGIN
  ? `${API_ORIGIN}/api-docs-json`
  : '/api/api-docs-json';

/**
 * The same document as a **file to save**, and the href of the "OpenAPI JSON"
 * link on the reference page.
 *
 * A second constant rather than a repoint of {@link OPENAPI_JSON}, because
 * that one is also what `docs/ApiReference.tsx` **fetches** to render the
 * reference: pointing it here would quietly turn the rendered reference into
 * a build-time snapshot. The fetch keeps the live URL; only the download link
 * is this copy (task 0270, D-02).
 *
 * ⚠️ Bundle-relative, and it must stay that way. `download` is honoured only
 * on a SAME-ORIGIN href — a browser given a cross-origin one ignores the
 * attribute and navigates instead. On the shared host the page is on
 * `sorobanscan.com` while `API_ORIGIN` is
 * `prices-api.sorobanscan.com`, so an `API_ORIGIN`-prefixed href
 * renders the JSON in a tab. In dev it would look fine — there the href goes
 * through the Vite proxy and IS same-origin — which is why
 * `links.spec.ts` asserts this value does not move when `API_ORIGIN` is set.
 *
 * The file itself is `public/openapi.json`, the committed output of `npm run
 * openapi:extract`; CI diffs the two so the copy cannot drift from what the API
 * serves. It ships as `/api/prices-api/openapi.json` — a path with an extension,
 * which the explorer's `/api/prices-api/*` behaviour serves as a file rather than
 * rewriting to `index.html` (it rewrites only extensionless paths).
 */
export const OPENAPI_JSON_DOWNLOAD = `${ROUTER_BASENAME}/openapi.json`;

/**
 * What the saved file is called. Names the API, so it is identifiable among
 * the other `openapi.json`s in a Downloads folder.
 */
export const OPENAPI_JSON_FILENAME = 'stellar-prices-api-openapi.json';

/**
 * The API reference route — the live OpenAPI document rendered in the
 * portal's own pieces, in Swagger UI's shape (task 0195,
 * `src/docs/ApiReference.tsx`). A ROUTE like the quick start, so it is a
 * `RouterLink` target inside the app; `API_REFERENCE` is the same place as an
 * absolute href for the plain `<a>`s on the landing page.
 *
 * On the shared host this URL works BECAUSE it is a route: the explorer's
 * `/api/prices-api/*` behaviour rewrites every extensionless path to
 * `/api/prices-api/index.html`, so `/api/prices-api/docs` boots this bundle and the
 * router renders the reference. A static `docs/` folder in the bundle would
 * have been reachable only as `/api/prices-api/docs/index.html`, which is why the
 * reference is a page and not a static folder.
 *
 * Until 2026-09-01 `API_REFERENCE` was an alias of {@link OPENAPI_JSON} —
 * the only reference that existed — and every "Swagger UI" affordance
 * silently opened the raw document.
 */
export const DOCS_ROUTE = '/docs';
/**
 * Since 2026-11-19 (akot) the reference is a page of the hub's, one for every
 * API, with a tab each: `/api/docs/prices`. {@link DOCS_ROUTE} is where it
 * was, and sends the browser there. Under the bundle's `base`, as
 * {@link HUB_LOGIN} is, and a plain `href` from this app for the same reason.
 *
 * The tab's own address, never the bare `/api/docs`: the explorer answered
 * that one with a `301` to `/api/prices-api/docs`, and a browser that kept
 * the redirect would be sent back here and loop.
 */
export const API_REFERENCE = `${import.meta.env.BASE_URL}docs/prices`;

/**
 * The quick start — the in-app page built from the Figma `Quick start` frame
 * (`918:644`). A ROUTE, so it is a `RouterLink` target like the dashboard;
 * `QUICKSTART` is the same place as an absolute href for the plain `<a>`s on
 * the landing page. Task 0163's curl-by-curl walkthrough is what its
 * snippets are meant to say once the two are reconciled.
 */
export const QUICKSTART_ROUTE = '/quick-start';
/**
 * Since 2026-11-19 the quick start is a page of the hub's too,
 * `/api/quick-start/prices`: see {@link API_REFERENCE}, whose reasons hold.
 */
export const QUICKSTART = `${import.meta.env.BASE_URL}quick-start/prices`;

/**
 * The privacy policy, a page of the hub's since 2026-11-20 (akot), one for every
 * API: `/api/privacy-policy`. It was this app's own page, at
 * `/api/prices-api/privacy-policy`, which {@link HUB_PRIVACY_POLICY} replaces.
 * Under the bundle's `base`, as {@link HUB_LOGIN} is, and a plain `href` from
 * this app for the same reason: a router link would make it
 * `/api/prices-api/api/privacy-policy`. Every link to the policy names it.
 */
export const PRIVACY_POLICY = `${import.meta.env.BASE_URL}privacy-policy`;

/**
 * Where this app's own `/privacy-policy` sends the browser: the same page, the
 * query telling the hub's side which portal's old address was followed.
 */
export const HUB_PRIVACY_POLICY = `${import.meta.env.BASE_URL}privacy-policy?from=prices`;

/**
 * The official Stellar Discord — **Stellar Developers**, and no other server
 * (Adam, 2026-09-02). This snowflake is the guild the backend's membership
 * gate checks: it is the value of the SSM parameter
 * `/prices/production/discord-guild-id`, and the two are ONE FACT in two
 * places. `tools/scripts/verify-discord-guild.mjs` resolves the invite below
 * through Discord's API and asserts it lands here — the drift it guards
 * against (invite to one server, gate on another) was invisible until task
 * 0254 measured it, because nothing compared them.
 */
export const STELLAR_DISCORD_GUILD_ID = '897514728459468821';

/**
 * The registered vanity invite, resolving to `STELLAR_DISCORD_GUILD_ID`. The
 * other invites SDF publishes are personal and at least one is already dead
 * (task 0179) — do not swap this for one found in a thread.
 */
export const STELLAR_DISCORD_INVITE = 'https://discord.gg/stellardev';

/**
 * The server itself, for a visitor who is ALREADY in it — a member following
 * the invite is told by Discord they are already a member and sent nowhere.
 * Discord opens a guild by id at this path (a member's own client picks the
 * channel); an unscreened member lands on the rules prompt, which is the one
 * click the `pending_rules` refusal asks for.
 */
export const STELLAR_DISCORD_SERVER = `https://discord.com/channels/${STELLAR_DISCORD_GUILD_ID}`;

/**
 * The in-page anchor every "Get API Key" control scrolls to — the login
 * section (Figma frame `778:2499`).
 *
 * Named `login` rather than `api-key` since that section arrived: the target is
 * where a visitor signs in, and the anchor is the one part of it that shows up
 * in a URL somebody may paste.
 */
export const LOGIN_ANCHOR = 'login';

/**
 * The login route, relative to the router's basename — so
 * `/api/prices-api/login` once `ROUTER_BASENAME` is applied.
 *
 * A hard refresh on this path resolves because the host's `/api/prices-api/*`
 * behaviour rewrites every extensionless path to `/api/prices-api/index.html` —
 * a rule, not an
 * allow-list, so adding a route here needs nothing on the hosting side. (Our
 * own distribution kept a per-route allow-list in `DirectoryIndexFn`; it was
 * retired by task 0195 once the page moved to the explorer's host.)
 */
export const LOGIN_ROUTE = '/login';

/** The dashboard route. Same deployment caveat as {@link LOGIN_ROUTE}. */
export const DASHBOARD_ROUTE = '/dashboard';

/**
 * The hub's sign-in, one for every API (the shared sign-in spec, "The Prices
 * portal moves in" and the cutover's step 3): where every "Get API Key" and
 * "Sign in" on these pages goes, and where {@link LOGIN_ROUTE} sends the
 * browser. Under the bundle's `base`, as the hub's own addresses are, so a
 * build for another prefix keeps it beside these pages.
 *
 * A page of another tree, so a plain `href`, never a router `to`: under this
 * app's basename a router link would make it `/api/prices-api/api/login…`.
 *
 * ⚠️ Never a bare `/api/login`. The explorer answered it with a `301` to
 * `/api/prices-api/login` before the hub took it over, and a browser that
 * cached that redirect would come back here and loop; the query makes it a
 * different URL. The hub's `/login` reads it to send a visitor who is signed
 * in already to the Prices tab.
 */
export const HUB_LOGIN = `${import.meta.env.BASE_URL}login?from=prices`;

/**
 * The Prices tab of the hub's dashboard, where {@link DASHBOARD_ROUTE} sends
 * the browser. Same reasons as {@link HUB_LOGIN}.
 */
export const HUB_DASHBOARD = `${import.meta.env.BASE_URL}dashboard/prices`;

/**
 * The landing page as an absolute href, for the pages that are NOT it.
 *
 * The navbar's three links name sections of the landing page (`#features`,
 * `#get-started`, `#faq`); on the quick start those anchors do not exist, so
 * they are prefixed with this and become links back to the page that has
 * them. Same basename treatment as {@link QUICKSTART}.
 */
export const LANDING = `${ROUTER_BASENAME}/`;

/**
 * The block explorer's home — where the SorobanScan wordmark in every bar
 * leads (task 0301): the portal is one page of SorobanScan, and the mark is
 * how a visitor gets back to the rest of it. Absolute, not `/`: on the shared
 * host the root is the explorer's, but under the dev server `/` is nothing.
 */
export const EXPLORER = 'https://sorobanscan.com/';

/** Rumble Fish's own site — where the footer's mark leads. */
export const RUMBLEFISH_SITE = 'https://rumblefish.dev';

/**
 * Rumble Fish's contact page — the footer's "Contact" and the refusal card's
 * "contact support" (task 0301). A sales form rather than a support desk, and
 * the nearest thing that reaches the company; the card's other word, "status
 * page", still has nowhere to go.
 */
export const RUMBLEFISH_CONTACT = 'https://www.rumblefish.dev/contact/';
