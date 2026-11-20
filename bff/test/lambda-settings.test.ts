import { describe, expect, it } from "vitest";
import { loadLambdaSettings } from "../src/lambda-settings.ts";

const DISCORD = "discord-client-secret-VALUE";
const SESSION = "A".repeat(64); // base64 of 48 bytes
const HEADER = JSON.stringify({ current: "c".repeat(40) });

const ENV = {
  HUB_PUBLIC_ORIGIN: "https://sorobanscan.com",
  HUB_PRODUCTS: "prices,x402",
  DISCORD_CLIENT_ID: "1234567890",
  HUB_DISCORD_SECRET_NAME: "hub/discord",
  HUB_SESSION_SECRET_NAME: "hub/session",
  HUB_ORIGIN_SECRET_NAME: "hub/origin",
};

const reader =
  (header = HEADER, session = SESSION) =>
  async (name: string) => {
    const secrets: Record<string, string> = {
      "hub/discord": DISCORD,
      "hub/session": session,
      "hub/origin": header,
    };
    const value = secrets[name];
    if (value === undefined) throw new Error(`no ${name}`);
    return value;
  };

async function message(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("resolved");
}

describe("loadLambdaSettings", () => {
  it("holds the environment's values and the three secrets", async () => {
    const settings = await loadLambdaSettings(ENV, reader());
    expect(settings).toMatchObject({
      publicOrigin: "https://sorobanscan.com",
      base: "/api/",
      products: ["prices", "x402"],
      discordClientId: "1234567890",
      discordClientSecret: DISCORD,
      originSecret: { current: "c".repeat(40) },
    });
    expect(settings.sessionSecret).toHaveLength(48);
    expect(settings.originSecret?.previous).toBeUndefined();
  });

  it("keeps the header secret's previous value", async () => {
    const header = JSON.stringify({ current: "c".repeat(32), previous: "p".repeat(32) });
    const settings = await loadLambdaSettings(ENV, reader(header));
    expect(settings.originSecret).toEqual({ current: "c".repeat(32), previous: "p".repeat(32) });
  });

  it("names why a read failed by the error's name only, never its message", async () => {
    class AccessDeniedException extends Error {
      override name = "AccessDeniedException";
    }
    const failing = async () => {
      throw new AccessDeniedException("arn:aws:secretsmanager:eu-central-1:1:secret:x denied");
    };
    const text = await message(loadLambdaSettings(ENV, failing));
    expect(text).toContain("AccessDeniedException");
    expect(text).not.toContain("arn:aws");
    expect(text).not.toContain("denied");
  });

  it.each(Object.keys(ENV))("rejects without %s, naming it", async (name) => {
    expect(await message(loadLambdaSettings({ ...ENV, [name]: undefined }, reader()))).toContain(
      name,
    );
  });

  it("rejects a secret that can't be read, naming the setting and not the reader's words", async () => {
    const text = await message(
      loadLambdaSettings(ENV, async () => {
        throw new Error("AccessDenied arn:aws:secret:LEAK");
      }),
    );
    expect(text).toContain("HUB_");
    expect(text).not.toContain("LEAK");
  });

  it.each([
    ["not JSON", "c".repeat(40) + "SECRETVALUE"],
    ["an array", JSON.stringify(["c".repeat(40)])],
    ["no current", JSON.stringify({ previous: "p".repeat(40) })],
    ["a short current", JSON.stringify({ current: "short-SECRETVALUE" })],
    ["a short previous", JSON.stringify({ current: "c".repeat(40), previous: "tiny" })],
    ["a number", JSON.stringify({ current: 12345 })],
  ])("rejects a header secret that is %s, without its value", async (_, header) => {
    const text = await message(loadLambdaSettings(ENV, reader(header)));
    expect(text).toContain("HUB_ORIGIN_SECRET_NAME");
    expect(text).not.toContain("SECRETVALUE");
    expect(text).not.toContain("cccccccc");
  });

  it("rejects a session secret that is too short, without its value", async () => {
    const text = await message(loadLambdaSettings(ENV, reader(HEADER, "QUJD")));
    expect(text).toContain("HUB_SESSION_SECRET");
    expect(text).not.toContain("QUJD");
  });
});
