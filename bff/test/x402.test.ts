import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { productClient, PRODUCT_TIMEOUT_MS, type Caller } from "../src/products/client.ts";
import { ACCOUNT_ID } from "./fake-discord.ts";
import { X402_KEY, X402_USAGE, x402Usual as usual } from "./fake-x402.ts";
import { envelopeOf, FakeProduct, type Answer } from "./fake-product.ts";

const NOW = Date.UTC(2026, 10, 18, 12);
const X402_API = "https://x402-portal.test/hub/v1";
const X402_SECRET = Buffer.alloc(32, 0x58);
const CALLER: Caller = { discordId: ACCOUNT_ID, name: "member" };
const envelope = envelopeOf("x402");

let logs: MockInstance[] = [];
const logged = () =>
  logs
    .flatMap((spy) =>
      spy.mock.calls.map((args, i) => ({
        at: spy.mock.invocationCallOrder[i] ?? 0,
        line: args.map(String).join(" "),
      })),
    )
    .sort((a, b) => a.at - b.at)
    .map(({ line }) => line)
    .join("\n");

beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(secret: Buffer = X402_SECRET) {
  const x402 = new FakeProduct(() => NOW, {
    product: "x402",
    label: "x402",
    api: X402_API,
    secret,
    usual,
  });
  const client = productClient({
    product: "x402",
    label: "x402",
    api: X402_API,
    signer: () => Promise.resolve(secret),
    fetchImpl: x402.fetch,
    now: () => NOW,
  });
  return { x402, client };
}

describe("the x402 client", () => {
  it("makes the four calls with a token for x402, whose MAC holds under x402's context", async () => {
    const { x402, client } = start();
    const answers = [
      await client.account(CALLER),
      await client.reveal(CALLER),
      await client.revoke(CALLER),
      await client.issue(CALLER),
    ];
    expect(answers.map((answer) => answer.ok)).toEqual([true, true, true, true]);
    expect(x402.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", `${X402_API}/account`],
      ["POST", `${X402_API}/key/reveal`],
      ["POST", `${X402_API}/key/revoke`],
      ["POST", `${X402_API}/key/issue`],
    ]);
    expect(x402.accepted).toHaveLength(4);
    expect(x402.accepted.map((call) => call.claims.act)).toEqual([
      "read",
      "reveal",
      "revoke",
      "issue",
    ]);
    for (const call of x402.accepted) {
      expect(call.claims).toMatchObject({ aud: "x402", sub: `discord:${ACCOUNT_ID}` });
      const [, payload = "", mac = ""] = call.token.split(".");
      const under = (context: string) =>
        createHmac("sha256", X402_SECRET)
          .update(Buffer.concat([Buffer.from(context), Buffer.of(0), Buffer.from(payload)]))
          .digest("base64url");
      expect(mac).toBe(under("sorobanscan-hub/x402-token/v1"));
      expect(mac).not.toBe(under("sorobanscan-hub/prices-token/v1"));
    }
  });

  it("passes a body on whole and logs key events as x402_ lines, with no token or key", async () => {
    const { x402, client } = start();
    expect(await client.reveal(CALLER)).toEqual({
      ok: true,
      body: usual("/key/reveal", ACCOUNT_ID),
    });
    const [call] = x402.accepted;
    expect(logged()).toBe(`x402_key_revealed discord:${ACCOUNT_ID} jti:${call?.claims.jti}`);
    expect(logged()).not.toContain(X402_KEY);
    expect(logged()).not.toContain(call?.token);
  });

  it("passes the account's details.usage on to the page whole, a null one too", async () => {
    const { x402, client } = start();
    const account = usual("/account", ACCOUNT_ID);
    expect(await client.account(CALLER)).toStrictEqual({ ok: true, body: account });
    expect(account.details).toStrictEqual({ showable: true, usage: X402_USAGE });
    // x402 couldn't read the month: the page is told so, not given zeros.
    const unread = { ...account, details: { showable: true, usage: null } };
    x402.answer("/account", () => Response.json(unread));
    expect(await client.account(CALLER)).toStrictEqual({ ok: true, body: unread });
  });

  it("answers 502 x402_unavailable when x402 can't be reached, naming only how", async () => {
    const { x402, client } = start();
    x402.answer("/account", () => new TypeError("fetch failed: secret-host.internal"));
    expect(await client.account(CALLER)).toEqual({
      ok: false,
      status: 502,
      error: "x402_unavailable",
    });
    expect(logged()).toMatch(/^x402_call_failed read discord:\d+ jti:\S+ \(could not reach x402: TypeError\)$/);
    expect(logged()).not.toContain("secret-host");
  });

  it("answers a 429 without an envelope with 503 x402_busy", async () => {
    const { x402, client } = start();
    x402.answer("/account", () => new Response("slow down", { status: 429 }));
    expect(await client.account(CALLER)).toEqual({ ok: false, status: 503, error: "x402_busy" });
    expect(logged()).toContain("x402 answered 429 without its error envelope");
  });

  it("tries once more after a 503, with a new token", async () => {
    const { x402, client } = start();
    x402.answer("/account", envelope(503, "unavailable"));
    expect((await client.account(CALLER)).ok).toBe(true);
    expect(x402.calls).toHaveLength(2);
    expect(x402.calls[0]?.token).not.toBe(x402.calls[1]?.token);
    expect(logged()).toContain("x402_call_retried read");
    expect(logged()).toContain("x402 answered 503 unavailable");
  });

  it("answers HTML, with 200 or 403, as 502 x402_unavailable, not repeating it", async () => {
    for (const status of [200, 403]) {
      vi.clearAllMocks();
      const { x402, client } = start();
      x402.answer(
        "/account",
        () => new Response("<html>a gateway's page</html>", { status }),
      );
      expect(await client.account(CALLER), String(status)).toEqual({
        ok: false,
        status: 502,
        error: "x402_unavailable",
      });
      expect(logged()).not.toContain("gateway");
      expect(x402.calls).toHaveLength(1);
    }
  });

  it("answers 404 no_key as 409 no_key, logged as an answer", async () => {
    const { x402, client } = start();
    x402.answer("/key/reveal", envelope(404, "no_key"));
    expect(await client.reveal(CALLER)).toEqual({ ok: false, status: 409, error: "no_key" });
    expect(logged()).toMatch(/^x402_call_answered reveal discord:\d+ jti:\S+ \(x402 answered 404 no_key\)$/);
  });

  it("answers 409 key_not_viewable as 409 key_not_viewable, logged as an answer", async () => {
    const { x402, client } = start();
    x402.answer("/key/reveal", envelope(409, "key_not_viewable"));
    expect(await client.reveal(CALLER)).toEqual({
      ok: false,
      status: 409,
      error: "key_not_viewable",
    });
    expect(logged()).toMatch(
      /^x402_call_answered reveal discord:\d+ jti:\S+ \(x402 answered 409 key_not_viewable\)$/,
    );
    expect(logged()).not.toContain("call_failed");
  });

  it("answers any other 404 as 502 x402_unavailable and a refused token as 502", async () => {
    const { x402, client } = start();
    x402.answer("/account", envelope(404, "not_found"), envelope(401, "invalid_token"));
    expect(await client.account(CALLER)).toMatchObject({ status: 502, error: "x402_unavailable" });
    expect(await client.account(CALLER)).toMatchObject({ status: 502, error: "invalid_token" });
  });

  it("answers product_not_configured without the secret, and asks x402 nothing", async () => {
    const x402 = new FakeProduct(() => NOW, {
      product: "x402",
      label: "x402",
      api: X402_API,
      secret: X402_SECRET,
      usual,
    });
    const failing = productClient({
      product: "x402",
      label: "x402",
      api: X402_API,
      signer: () => Promise.reject(new Error("not today")),
      fetchImpl: x402.fetch,
    });
    expect(await failing.account(CALLER)).toEqual({
      ok: false,
      status: 503,
      error: "product_not_configured",
    });
    expect(x402.calls).toEqual([]);
  });

  it("gives up 20 seconds after the call started", async () => {
    vi.useFakeTimers();
    const { x402, client } = start();
    x402.answer("/account", () => "hang" as Answer);
    const answer = client.account(CALLER);
    await vi.advanceTimersByTimeAsync(PRODUCT_TIMEOUT_MS);
    expect(await answer).toEqual({ ok: false, status: 502, error: "x402_unavailable" });
    expect(logged()).toContain("x402 did not answer in 20 s");
  });
});
