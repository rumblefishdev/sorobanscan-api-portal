/**
 * The prefix this app is served from — one definition, two consumers.
 *
 * The bundle is served under `/api/prices-api/` on the shared host (task 0339;
 * `/api/` from task 0194, `/prices-api/` from task 0326, both now a 301 there)
 * and only ever answers there.
 * Getting there takes two settings that must agree: Vite's `base` covers
 * ASSETS, react-router's `basename` covers ROUTES, and either one alone leaves
 * the app broken on the only URL it is served from.
 *
 * They differ by exactly one character and that difference is load-bearing, not
 * a copy-paste mistake — Vite treats a `base` without a trailing slash as a
 * prefix to concatenate and emits `/api/prices-apiassets/…`, while react-router
 * strips a trailing `basename` and warns if given one. So `ROUTER_BASENAME` is
 * DERIVED rather than typed out a second time.
 *
 * In sorobanscan-api-portal the bundle is the hub's, built for the hub's
 * `base` (`/api/` unless `VITE_BASE_PATH` names another), and this portal is
 * the tree `src/boot.js` boots for the addresses under `prices-api/` there. So
 * `BASE_PATH` is derived from that `base` rather than typed out, and a build
 * for another prefix keeps these routes under it.
 *
 * This is a BUILD-time concern. CloudFront cannot fix it after the fact, which
 * is why task 0185 put it in the first commit rather than discovering it on the
 * first deploy.
 */

/** The bundle's `base` and `prices-api/`. Trailing slash required. */
export const BASE_PATH = import.meta.env.BASE_URL + 'prices-api/';

/** react-router's `basename`. Same prefix, no trailing slash. */
export const ROUTER_BASENAME = BASE_PATH.replace(/\/$/, '');
