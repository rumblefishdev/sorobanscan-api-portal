import { createHmac } from "node:crypto";
import { inspect } from "node:util";
import {
  GetSecretValueCommand,
  type GetSecretValueCommandInput,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  FAILURE_TTL_MS,
  ProductSecretError,
  SECRET_READ_DEADLINE_MS,
  SECRET_TTL_MS,
  productSecret,
  secretsManager,
  type SecretsClient,
} from "../src/product-secret.ts";
import { TOKEN_PRODUCTS, mintToken } from "../src/token.ts";

let logs: MockInstance[] = [];
/** Everything written to the console in the running test. */
const logged = () =>
  logs.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");

beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Everything an error shows wherever it is printed: its message, its stack, its cause. */
const shown = (error: unknown) => `${String(error)}\n${inspect(error, { depth: 5 })}`;

/** A secret in each form it could be printed in. */
const forms = (secret: Buffer) => [
  secret.toString("base64"),
  secret.toString("base64url"),
  secret.toString("hex"),
];

/** The shared sign-in spec's decision 15: the vector both the hub and Prices pin. */
const VECTOR = {
  secret: Buffer.from("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=", "base64"),
  claims:
    '{"iss":"https://sorobanscan.com/api/hub","aud":"prices","sub":"discord:80351110224678912","name":"nelly","iat":1795000000,"exp":1795000060,"jti":"AAECAwQFBgcICQoLDA0ODw","act":"reveal"}',
  token:
    "v1.eyJpc3MiOiJodHRwczovL3Nvcm9iYW5zY2FuLmNvbS9hcGkvaHViIiwiYXVkIjoicHJpY2VzIiwic3ViIjoiZGlzY29yZDo4MDM1MTExMDIyNDY3ODkxMiIsIm5hbWUiOiJuZWxseSIsImlhdCI6MTc5NTAwMDAwMCwiZXhwIjoxNzk1MDAwMDYwLCJqdGkiOiJBQUVDQXdRRkJnY0lDUW9MREEwT0R3IiwiYWN0IjoicmV2ZWFsIn0.aeS9_nACshTGuf2Afv4wbQhvLR-f64XCX0OVmmngofE",
};

describe("a product token", () => {
  it("is the spec's test vector, byte for byte", () => {
    const token = mintToken(VECTOR.secret, {
      product: "prices",
      discordId: "80351110224678912",
      name: "nelly",
      act: "reveal",
      now: 1_795_000_000_000,
      jti: "AAECAwQFBgcICQoLDA0ODw",
    });
    expect(token).toBe(VECTOR.token);
    // And the vector is what the spec says it is: its payload is exactly the claims' bytes, its
    // MAC over the context, a zero byte and the payload.
    const [version, payload = "", mac] = token.split(".");
    expect(version).toBe("v1");
    expect(Buffer.from(payload, "base64url").toString("utf8")).toBe(VECTOR.claims);
    expect(mac).toBe(
      createHmac("sha256", VECTOR.secret)
        .update(
          Buffer.concat([
            Buffer.from("sorobanscan-hub/prices-token/v1"),
            Buffer.of(0),
            Buffer.from(payload),
          ]),
        )
        .digest("base64url"),
    );
  });

  const SECRET = Buffer.alloc(32, 7);
  const CALLER = { product: "prices" as const, discordId: "80351110224678912", name: "nelly", now: 1_795_000_000_999 };
  const claimsOf = (token: string) =>
    JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;

  it("signs x402's token under its own audience and context", () => {
    const x402 = {
      product: "x402" as const,
      discordId: "80351110224678912",
      name: "nelly",
      act: "reveal" as const,
      now: 1_795_000_000_000,
      jti: "AAECAwQFBgcICQoLDA0ODw",
    };
    const token = mintToken(VECTOR.secret, x402);
    expect(token).toBe(
      "v1.eyJpc3MiOiJodHRwczovL3Nvcm9iYW5zY2FuLmNvbS9hcGkvaHViIiwiYXVkIjoieDQwMiIsInN1YiI6ImRpc2NvcmQ6ODAzNTExMTAyMjQ2Nzg5MTIiLCJuYW1lIjoibmVsbHkiLCJpYXQiOjE3OTUwMDAwMDAsImV4cCI6MTc5NTAwMDA2MCwianRpIjoiQUFFQ0F3UUZCZ2NJQ1FvTERBME9EdyIsImFjdCI6InJldmVhbCJ9.mpP3cY6Kclck-SvWeTU6bYt9xnTiVNmx91xl6L1Qkho",
    );
    const prices = mintToken(VECTOR.secret, { ...x402, product: "prices" });
    expect(token.split(".")[2]).not.toBe(prices.split(".")[2]);
    expect(claimsOf(token).aud).toBe("x402");
    expect(TOKEN_PRODUCTS).toEqual(["prices", "x402"]);
  });

  it("refuses a product it has no token for, naming the field", () => {
    for (const product of ["", "price", "X402", undefined] as unknown as "prices"[]) {
      expect(() => mintToken(SECRET, { ...CALLER, act: "read", product }), String(product)).toThrow(
        /product/,
      );
    }
  });

  it("carries exactly the claims, in order, with a fresh random jti of 16 bytes", () => {
    const first = claimsOf(mintToken(SECRET, { ...CALLER, act: "read" }));
    expect(Object.keys(first)).toEqual(["iss", "aud", "sub", "name", "iat", "exp", "jti", "act"]);
    expect(first).toEqual({
      iss: "https://sorobanscan.com/api/hub",
      aud: "prices",
      sub: "discord:80351110224678912",
      name: "nelly",
      // Whole seconds, rounded down from the milliseconds `now` is given in, and 60 more.
      iat: 1_795_000_000,
      exp: 1_795_000_060,
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      act: "read",
    });
    expect(Buffer.from(first.jti as string, "base64url")).toHaveLength(16);
    const second = claimsOf(mintToken(SECRET, { ...CALLER, act: "read" }));
    expect(second.jti).not.toBe(first.jti);
  });

  it("names each act it is for, and no other", () => {
    for (const act of ["read", "reveal", "revoke", "issue"] as const) {
      expect(claimsOf(mintToken(SECRET, { ...CALLER, act })).act).toBe(act);
    }
    for (const act of ["", "write", "READ", "issue "]) {
      expect(() => mintToken(SECRET, { ...CALLER, act: act as "read" }), act).toThrow(/act/);
    }
  });

  it("refuses a subject that isn't a Discord id, a malformed jti and a clock that isn't one", () => {
    for (const discordId of ["", "nelly", "1 2", "1".repeat(21), undefined as unknown as string]) {
      expect(() => mintToken(SECRET, { ...CALLER, act: "read", discordId }), discordId).toThrow(
        /Discord id/,
      );
    }
    // Only what a fresh one would be: 16 bytes, base64url without padding, as written.
    for (const jti of [
      "",
      "short",
      "AAECAwQFBgcICQoLDA0ODw==",
      "AAECAwQFBgcICQoLDA0OD+",
      "AAECAwQFBgcICQoLDA0ODx",
      "AAECAwQFBgcICQoLDA0ODwAA",
    ]) {
      expect(() => mintToken(SECRET, { ...CALLER, act: "read", jti }), jti).toThrow(/jti/);
    }
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => mintToken(SECRET, { ...CALLER, act: "read", now }), String(now)).toThrow(/now/);
    }
    expect(() =>
      mintToken(SECRET, { ...CALLER, act: "read", name: undefined as unknown as string }),
    ).toThrow(/name/);
  });

  it("refuses a secret that isn't 32 bytes, without showing it", () => {
    for (const secret of [Buffer.alloc(0), Buffer.alloc(31, 0xa5), Buffer.alloc(33, 0xa5)]) {
      let error: unknown;
      try {
        mintToken(secret, { ...CALLER, act: "read" });
      } catch (thrown) {
        error = thrown;
      }
      expect(error, String(secret.length)).toBeInstanceOf(Error);
      expect(shown(error)).toMatch(/secret/);
      for (const form of forms(secret).filter(Boolean)) expect(shown(error)).not.toContain(form);
    }
  });

  it("keeps a name as JSON has it, quotes and all, in UTF-8", () => {
    for (const name of ['ne"lly\\', "zoë", "名前", "a b"]) {
      const token = mintToken(SECRET, { ...CALLER, act: "read", name });
      expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
      expect(claimsOf(token).name).toBe(name);
    }
  });

  it("is never logged", () => {
    const token = mintToken(SECRET, { ...CALLER, act: "issue" });
    expect(logged()).toBe("");
    expect(token).not.toContain(SECRET.toString("base64url"));
  });
});

describe("the product secret", () => {
  const NAME = "sorobanscan-hub/production/prices-token";
  const CURRENT = Buffer.alloc(32, 0xa5);
  const PREVIOUS = Buffer.alloc(32, 0x5a);
  const SECRET_STRING = JSON.stringify({
    current: CURRENT.toString("base64"),
    previous: PREVIOUS.toString("base64"),
  });

  type Answer = string | undefined | Error;

  /**
   * Secrets Manager in memory: each read takes the next answer, the last one again once they run
   * out. A string is the secret's text, `undefined` a secret with no text (a binary one), an error
   * what the SDK throws. Every command sent is kept as it came, for the test to check: an
   * assertion inside `send` would be caught by the read and turned into a failed read.
   */
  function fakeSecrets(...answers: Answer[]) {
    const sent: unknown[] = [];
    const client: SecretsClient = {
      async send(command) {
        sent.push(command);
        const answer = answers.length > 1 ? answers.shift() : answers[0];
        if (answer instanceof Error) throw answer;
        return { SecretString: answer };
      },
    };
    return { client, sent };
  }

  /** What each command sent asked for, after checking it is a `GetSecretValue`. */
  const inputsOf = (sent: unknown[]): GetSecretValueCommandInput[] =>
    sent.map((command) => {
      expect(command).toBeInstanceOf(GetSecretValueCommand);
      return (command as GetSecretValueCommand).input;
    });

  /** A clock the test moves. */
  function clock() {
    let t = Date.UTC(2026, 10, 18, 12);
    return { now: () => t, advance: (ms: number) => void (t += ms) };
  }

  /** The error `promise` rejects with, or a failure if it resolves. */
  async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error("expected the read to fail");
  }

  /** An error as the SDK throws one, with a message no log or error of ours should repeat. */
  const sdkError = (name: string) =>
    Object.assign(new Error(`${name}: the SDK's own words, say-nothing-of-this`), { name });

  it("is the named secret's current value, 32 bytes, read from Secrets Manager", async () => {
    const { client, sent } = fakeSecrets(SECRET_STRING);
    const secret = await productSecret(NAME, client)();
    expect(secret.equals(CURRENT)).toBe(true);
    expect(inputsOf(sent)).toEqual([{ SecretId: NAME }]);
    expect(logged()).toBe("");
  });

  it("is read from eu-central-1, whatever region the environment names", async () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    const client = secretsManager() as SecretsManagerClient;
    expect(await client.config.region()).toBe("eu-central-1");
  });

  it("refuses a secret that isn't JSON with a 32-byte base64 current, without showing it", async () => {
    const fill = (bytes: number) => Buffer.alloc(bytes, 0xa5).toString("base64");
    const urlSafe = Buffer.alloc(32, 0xfb).toString("base64url");
    // `paWl` is how bytes of 0xa5 start in base64, `-_v7` bytes of 0xfb in base64url.
    const markers = ["paWlpaWl", "-_v7-_v7", "+/v7+/v7"];
    for (const [what, text] of [
      ["a binary secret", undefined],
      ["empty", ""],
      ["the value alone, not JSON", fill(32)],
      ["cut short", `{"current":"${fill(32)}"`],
      ["an array", `["${fill(32)}"]`],
      ["a string", JSON.stringify(fill(32))],
      ["null", "null"],
      ["no current", JSON.stringify({ previous: fill(32) })],
      ["a current that isn't a string", JSON.stringify({ current: 32 })],
      ["31 bytes", JSON.stringify({ current: fill(31) })],
      ["33 bytes", JSON.stringify({ current: fill(33) })],
      ["base64url", JSON.stringify({ current: urlSafe })],
      ["no padding", JSON.stringify({ current: fill(32).replace(/=+$/, "") })],
      ["a line break after it", JSON.stringify({ current: `${fill(32)}\n` })],
      ["a space before it", JSON.stringify({ current: ` ${fill(32)}` })],
    ] as const) {
      const { client, sent } = fakeSecrets(text);
      const error = await rejectionOf(productSecret(NAME, client)());
      expect(error, what).toBeInstanceOf(ProductSecretError);
      expect(inputsOf(sent), what).toEqual([{ SecretId: NAME }]);
      expect(shown(error), what).toContain(NAME);
      for (const marker of markers) {
        expect(shown(error), what).not.toContain(marker);
        expect(logged(), what).not.toContain(marker);
      }
    }
  });

  it("names why it couldn't be read, not what the SDK said", async () => {
    for (const name of [
      "CredentialsProviderError",
      "AccessDeniedException",
      "ResourceNotFoundException",
      "ExpiredTokenException",
    ]) {
      const { client, sent } = fakeSecrets(sdkError(name));
      const error = await rejectionOf(productSecret(NAME, client)());
      expect(error, name).toBeInstanceOf(ProductSecretError);
      expect(inputsOf(sent), name).toEqual([{ SecretId: NAME }]);
      expect((error as Error).message, name).toContain(NAME);
      expect((error as Error).message, name).toContain(name);
      expect(shown(error), name).not.toContain("say-nothing-of-this");
    }
    expect(logged()).not.toContain("say-nothing-of-this");
  });

  it("logs each failed read once, naming the secret and the reason", async () => {
    const { client, sent } = fakeSecrets(sdkError("CredentialsProviderError"));
    const time = clock();
    const secret = productSecret(NAME, client, time.now);
    await rejectionOf(secret());
    await rejectionOf(secret());
    expect(inputsOf(sent)).toEqual([{ SecretId: NAME }]);
    const lines = logged().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^product_secret_unavailable .*CredentialsProviderError/);
    expect(lines[0]).toContain(NAME);
  });

  it("is kept for five minutes, then read again, so a new current is taken up", async () => {
    const next = Buffer.alloc(32, 0x3c);
    const { client, sent } = fakeSecrets(
      SECRET_STRING,
      JSON.stringify({ current: next.toString("base64"), previous: CURRENT.toString("base64") }),
    );
    const time = clock();
    const secret = productSecret(NAME, client, time.now);

    expect((await secret()).equals(CURRENT)).toBe(true);
    time.advance(SECRET_TTL_MS - 1);
    expect((await secret()).equals(CURRENT)).toBe(true);
    expect(inputsOf(sent)).toEqual([{ SecretId: NAME }]);

    time.advance(1);
    expect((await secret()).equals(next)).toBe(true);
    expect(inputsOf(sent)).toEqual([{ SecretId: NAME }, { SecretId: NAME }]);
    expect(SECRET_TTL_MS).toBe(5 * 60 * 1000);
    expect(logged()).toBe("");
  });

  it("is read once for calls that come while a read is under way", async () => {
    let answer: (value: { SecretString: string }) => void = () => {};
    let reads = 0;
    const client: SecretsClient = {
      send: () => {
        reads += 1;
        return new Promise((resolve) => (answer = resolve));
      },
    };
    const secret = productSecret(NAME, client, clock().now);
    const [first, second] = [secret(), secret()];
    answer({ SecretString: SECRET_STRING });
    expect((await first).equals(CURRENT)).toBe(true);
    expect((await second).equals(CURRENT)).toBe(true);
    expect(reads).toBe(1);
  });

  // Credentials expired locally, or Secrets Manager out of reach: the next try is at most 10 s
  // away, and the calls in between don't each wait on AWS.
  it("keeps a failure for at most 10 seconds, then reads again", async () => {
    const { client, sent } = fakeSecrets(sdkError("ExpiredTokenException"), SECRET_STRING);
    const time = clock();
    const secret = productSecret(NAME, client, time.now);

    await rejectionOf(secret());
    time.advance(FAILURE_TTL_MS - 1);
    expect(await rejectionOf(secret())).toBeInstanceOf(ProductSecretError);
    expect(inputsOf(sent)).toHaveLength(1);

    time.advance(1);
    expect((await secret()).equals(CURRENT)).toBe(true);
    expect(inputsOf(sent)).toEqual([{ SecretId: NAME }, { SecretId: NAME }]);
    expect(FAILURE_TTL_MS).toBeLessThanOrEqual(10_000);
  });

  it("reads a malformed secret again too, once it's fixed", async () => {
    const { client, sent } = fakeSecrets(JSON.stringify({ current: "nope" }), SECRET_STRING);
    const time = clock();
    const secret = productSecret(NAME, client, time.now);
    expect(await rejectionOf(secret())).toBeInstanceOf(ProductSecretError);
    time.advance(FAILURE_TTL_MS);
    expect((await secret()).equals(CURRENT)).toBe(true);
    expect(inputsOf(sent)).toEqual([{ SecretId: NAME }, { SecretId: NAME }]);
  });

  // AWS credentials that never resolve (an SSO login waiting on a browser, a metadata endpoint
  // that drops packets) would otherwise hold the read, and every call to the product after it,
  // for good: the cache keeps a read under way for as long as it lasts.
  it("gives up on a read that hasn't settled in 15 seconds, and reads again 10 seconds later", async () => {
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      const answers: (() => Promise<{ SecretString: string }>)[] = [
        () => new Promise(() => {}),
        async () => ({ SecretString: SECRET_STRING }),
      ];
      const client: SecretsClient = {
        send(command) {
          sent.push(command);
          return (answers.shift() ?? (() => new Promise(() => {})))();
        },
      };
      const time = clock();
      const secret = productSecret(NAME, client, time.now);

      let settled = false;
      const first = rejectionOf(secret()).finally(() => (settled = true));
      await vi.advanceTimersByTimeAsync(SECRET_READ_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await first;
      expect(error).toBeInstanceOf(ProductSecretError);
      expect((error as Error).message).toContain(NAME);
      expect((error as Error).message).toMatch(/15 s/);
      expect(logged()).toMatch(/^product_secret_unavailable .*15 s/);
      expect(SECRET_READ_DEADLINE_MS).toBe(15_000);

      // A failure like any other: answered from memory, then read again.
      time.advance(FAILURE_TTL_MS - 1);
      expect(await rejectionOf(secret())).toBe(error);
      expect(inputsOf(sent)).toHaveLength(1);
      time.advance(1);
      expect((await secret()).equals(CURRENT)).toBe(true);
      expect(inputsOf(sent)).toEqual([{ SecretId: NAME }, { SecretId: NAME }]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Given up on is not enough: the SDK's request would hold its socket until its own timeouts.
  it("cancels the request to Secrets Manager it gave up on", async () => {
    vi.useFakeTimers();
    try {
      const signals: (AbortSignal | undefined)[] = [];
      const client: SecretsClient = {
        send(_command, options) {
          signals.push(options?.abortSignal);
          return new Promise(() => {});
        },
      };
      const read = rejectionOf(productSecret(NAME, client, clock().now)());
      await vi.advanceTimersByTimeAsync(SECRET_READ_DEADLINE_MS - 1);
      expect(signals).toHaveLength(1);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await read).toBeInstanceOf(ProductSecretError);
      expect(signals[0]?.aborted).toBe(true);

      // A read that settles in time is never cancelled.
      const { client: quick } = fakeSecrets(SECRET_STRING);
      const given: (AbortSignal | undefined)[] = [];
      const watched: SecretsClient = {
        send(command, options) {
          given.push(options?.abortSignal);
          return quick.send(command, options);
        },
      };
      await productSecret(NAME, watched, clock().now)();
      await vi.advanceTimersByTimeAsync(SECRET_READ_DEADLINE_MS);
      expect(given[0]?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer behind once a read has settled", async () => {
    vi.useFakeTimers();
    try {
      const { client } = fakeSecrets(SECRET_STRING, sdkError("AccessDeniedException"));
      const time = clock();
      const secret = productSecret(NAME, client, time.now);
      await secret();
      expect(vi.getTimerCount()).toBe(0);
      time.advance(SECRET_TTL_MS);
      await rejectionOf(secret());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows the secret it read", async () => {
    const { client, sent } = fakeSecrets(SECRET_STRING, sdkError("AccessDeniedException"));
    const time = clock();
    const secret = productSecret(NAME, client, time.now);
    await secret();
    time.advance(SECRET_TTL_MS);
    const error = await rejectionOf(secret());
    expect(inputsOf(sent)).toEqual([{ SecretId: NAME }, { SecretId: NAME }]);
    for (const form of [...forms(CURRENT), ...forms(PREVIOUS)]) {
      expect(logged()).not.toContain(form);
      expect(shown(error)).not.toContain(form);
    }
  });
});
