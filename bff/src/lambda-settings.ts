/*
 * The hub's settings on AWS Lambda: the plain ones come from the function's environment, the
 * three secrets from Secrets Manager by the names the environment holds. No value of a secret is
 * ever put in an error or a log line.
 */
import { readSettings, type HubSettings } from "./settings.ts";

/** The app's prefix: the hub's page and backend are under `/api/`. */
const BASE = "/api/";
/** The least a header secret may be, in characters. */
const MIN_ORIGIN_SECRET_CHARS = 32;

/** The environment's names the Lambda can't start without. */
const REQUIRED = [
  "HUB_PUBLIC_ORIGIN",
  "HUB_PRODUCTS",
  "DISCORD_CLIENT_ID",
  "HUB_DISCORD_SECRET_NAME",
  "HUB_SESSION_SECRET_NAME",
  "HUB_ORIGIN_SECRET_NAME",
] as const;

/**
 * The settings for the function's `env`, reading each secret's text with `read` (Secrets
 * Manager's `SecretString` by the secret's name). Discord's is the client secret as plain text,
 * the session's is plain text that is base64 of at least 32 bytes, and the header's is JSON
 * `{"current": string, "previous"?: string}` of at least 32 characters each. Rejects, naming the
 * setting and never a value, when a name is missing, a secret can't be read or has the wrong
 * form. The result always has `originSecret`.
 */
export async function loadLambdaSettings(
  env: Record<string, string | undefined>,
  read: (name: string) => Promise<string>,
): Promise<HubSettings> {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`The Lambda's environment lacks ${missing.join(", ")}`);
  }

  const text = async (setting: (typeof REQUIRED)[number]): Promise<string> => {
    let value: unknown;
    try {
      value = await read(env[setting] as string);
    } catch {
      // Not the reader's message: it can carry an ARN or more.
      throw new Error(`The secret ${setting} names could not be read`);
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`The secret ${setting} names holds no text`);
    }
    return value;
  };

  const [discord, session, header] = await Promise.all([
    text("HUB_DISCORD_SECRET_NAME"),
    text("HUB_SESSION_SECRET_NAME"),
    text("HUB_ORIGIN_SECRET_NAME"),
  ]);

  const originSecret = parseOriginSecret(header);

  const settings = readSettings(
    {
      HUB_PUBLIC_ORIGIN: env.HUB_PUBLIC_ORIGIN,
      HUB_PRODUCTS: env.HUB_PRODUCTS,
      DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID,
      DISCORD_CLIENT_SECRET: discord.trim(),
      HUB_SESSION_SECRET: session.trim(),
    },
    BASE,
  );
  // Every name and secret is present, so only an empty one could land here.
  if (!settings) throw new Error("The Lambda's settings are incomplete");
  return { ...settings, originSecret };
}

function parseOriginSecret(text: string): NonNullable<HubSettings["originSecret"]> {
  const form = `The secret HUB_ORIGIN_SECRET_NAME names must be JSON {"current": string, "previous"?: string}, each at least ${MIN_ORIGIN_SECRET_CHARS} characters`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not the parser's message: it quotes the text it failed on.
    throw new Error(form);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(form);
  const { current, previous } = parsed as { current?: unknown; previous?: unknown };
  const long = (value: unknown): value is string =>
    typeof value === "string" && value.length >= MIN_ORIGIN_SECRET_CHARS;
  if (!long(current) || (previous !== undefined && !long(previous))) throw new Error(form);
  return previous === undefined ? { current } : { current, previous };
}
