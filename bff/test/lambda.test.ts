import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SESSION_TTL_SECONDS } from "../src/app.ts";
import { createLambdaHandler } from "../src/lambda.ts";
import { FAILURE_TTL_MS } from "../src/product-secret.ts";
import { tokens } from "../src/tokens.ts";

const ORIGIN = "https://sorobanscan.com";
const SESSION_BYTES = Buffer.from("A".repeat(64), "base64");
const HEADER_SECRET = "h".repeat(40);

const ENV = {
  HUB_PUBLIC_ORIGIN: ORIGIN,
  HUB_PRODUCTS: "prices,x402",
  DISCORD_CLIENT_ID: "1234567890",
  HUB_DISCORD_SECRET_NAME: "hub/discord",
  HUB_SESSION_SECRET_NAME: "hub/session",
  HUB_ORIGIN_SECRET_NAME: "hub/origin",
};

const SECRETS: Record<string, string> = {
  "hub/discord": "the-client-secret",
  "hub/session": "A".repeat(64),
  "hub/origin": JSON.stringify({ current: HEADER_SECRET }),
};

/** A function URL event, payload format 2.0. */
function event(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    cookies?: string[];
    body?: string;
    base64?: boolean;
  } = {},
) {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { host: "hub.lambda-url.eu-central-1.on.aws", ...options.headers },
    cookies: options.cookies,
    body: options.body ?? null,
    isBase64Encoded: options.base64 ?? false,
    requestContext: {
      accountId: "anonymous",
      apiId: "x",
      domainName: "hub.lambda-url.eu-central-1.on.aws",
      domainPrefix: "hub",
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "203.0.113.9", userAgent: "t" },
      requestId: "r",
      routeKey: "$default",
      stage: "$default",
      time: "",
      timeEpoch: 0,
    },
  };
}

const through = { "x-hub-origin-secret": HEADER_SECRET, "x-hub-viewer-ip": "203.0.113.9" };

let errors: MockInstance;
beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const run = (handler: ReturnType<typeof createLambdaHandler>, e: ReturnType<typeof event>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(e as any, {} as any) as Promise<{
    statusCode: number;
    body?: string;
    headers?: Record<string, string>;
    cookies?: string[];
  }>;

const readSecrets = async (name: string) => {
  const value = SECRETS[name];
  if (value === undefined) throw new Error(`no ${name}`);
  return value;
};

describe("the Lambda's handler", () => {
  it("answers GET me for a request through the site", async () => {
    const handler = createLambdaHandler({ read: readSecrets });
    const result = await run(handler, event("GET", "/api/hub/me", { headers: through }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "")).toEqual({ authenticated: false });
  });

  it("refuses a request without the CloudFront secret", async () => {
    const handler = createLambdaHandler({ read: readSecrets });
    const result = await run(handler, event("GET", "/api/hub/me"));
    expect(result.statusCode).toBe(400);
  });

  it("starts a sign-in with its cookie in the result's cookies", async () => {
    const handler = createLambdaHandler({ read: readSecrets });
    const result = await run(handler, event("GET", "/api/hub/auth/login", { headers: through }));
    expect(result.statusCode).toBe(303);
    expect(result.cookies?.some((line) => line.startsWith("hub_oauth="))).toBe(true);
  });

  it("takes a base64 form body, with the session cookie", async () => {
    const session = tokens(SESSION_BYTES).sign(
      "session",
      { id: "123456789012345678", username: "member" },
      SESSION_TTL_SECONDS,
    );
    const handler = createLambdaHandler({ read: readSecrets });
    const result = await run(
      handler,
      event("POST", "/api/hub/auth/issue", {
        headers: {
          ...through,
          origin: ORIGIN,
          "content-type": "application/x-www-form-urlencoded",
        },
        cookies: [`hub_session=${session}`],
        body: Buffer.from("product=prices").toString("base64"),
        base64: true,
      }),
    );
    expect(result.statusCode).toBe(303);
    expect(result.headers?.location).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize\?/);
  });

  it("answers 503 while a secret can't be read, reads again only after the failure's TTL", async () => {
    let now = 1_000_000;
    let failing = true;
    const read = vi.fn(async (name: string) => {
      if (failing) throw new Error("AccessDenied LEAKED-VALUE");
      return readSecrets(name);
    });
    const handler = createLambdaHandler({ read, now: () => now });
    const ask = () => run(handler, event("GET", "/api/hub/me", { headers: through }));

    const first = await ask();
    expect(first.statusCode).toBe(503);
    expect(JSON.parse(first.body ?? "")).toMatchObject({ error: "sign_in_not_configured" });
    const reads = read.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(/^startup_failed /);
    expect(String(errors.mock.calls[0]?.[0])).not.toContain("LEAKED");

    now += FAILURE_TTL_MS - 1;
    expect((await ask()).statusCode).toBe(503);
    expect(read).toHaveBeenCalledTimes(reads);
    expect(errors).toHaveBeenCalledTimes(1);

    failing = false;
    now += 2;
    const served = await ask();
    expect(read.mock.calls.length).toBeGreaterThan(reads);
    expect(served.statusCode).toBe(200);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
