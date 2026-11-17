/** What the hub's backend needs to sign anyone in. Read on the server, never put in the bundle. */
export type HubSettings = {
  /** The page's origin, as a browser names it in `Origin`: Discord's callback is under it. */
  publicOrigin: string;
  /** The app's prefix, `/api/`: the backend answers under `${base}hub/`. */
  base: string;
  discordClientId: string;
  discordClientSecret: string;
  /** Signs the session and the sign-in's two halves. */
  sessionSecret: Buffer;
  /** The Discord server an account must be a member of. */
  guildId: string;
};

/** Stellar Developers, the Discord server whose members may sign in. */
export const STELLAR_DEVELOPERS_GUILD = "897514728459468821";
const MIN_SECRET_BYTES = 32;

const SNOWFLAKE = /^[0-9]{1,20}$/;
/** Standard base64 with its padding, as `openssl rand -base64 32` prints it. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The settings sign-in can't do without. `HUB_PUBLIC_ORIGIN` has no default here: whatever runs
 * the hub names where its page is, and the dev and preview servers give their own
 * (`vite-plugin.ts`).
 */
export const REQUIRED_SETTINGS = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "HUB_SESSION_SECRET",
  "HUB_PUBLIC_ORIGIN",
] as const;

/** Which of {@link REQUIRED_SETTINGS} `env` lacks or holds empty, by name. */
export const missingSettings = (env: Record<string, string | undefined>): string[] =>
  REQUIRED_SETTINGS.filter((name) => !env[name]);

/**
 * The settings from `env`: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `HUB_SESSION_SECRET`
 * (base64 of at least 32 bytes) and `HUB_PUBLIC_ORIGIN`, and the optional `DISCORD_GUILD_ID`
 * (Stellar Developers). Every value present is checked first, so a malformed one throws whether
 * or not the others are set, naming the setting and never repeating a secret. Then `undefined`
 * when one of the four is missing or empty: sign-in is not configured.
 */
export function readSettings(
  env: Record<string, string | undefined>,
  base: string,
): HubSettings | undefined {
  const secret = env.HUB_SESSION_SECRET;
  if (secret && (!BASE64.test(secret) || Buffer.from(secret, "base64").length < MIN_SECRET_BYTES)) {
    throw new Error(
      `HUB_SESSION_SECRET must be base64 of at least ${MIN_SECRET_BYTES} bytes, as \`openssl rand -base64 32\` prints it`,
    );
  }

  const guildId = env.DISCORD_GUILD_ID || STELLAR_DEVELOPERS_GUILD;
  if (!SNOWFLAKE.test(guildId)) {
    throw new Error(`DISCORD_GUILD_ID must be a Discord server's id, digits only; got "${guildId}"`);
  }

  const publicOrigin = env.HUB_PUBLIC_ORIGIN;
  if (publicOrigin && !isOrigin(publicOrigin)) {
    throw new Error(
      `HUB_PUBLIC_ORIGIN must be an origin, as "https://sorobanscan.com" is, with no path or trailing slash; got "${publicOrigin}"`,
    );
  }

  const discordClientId = env.DISCORD_CLIENT_ID;
  const discordClientSecret = env.DISCORD_CLIENT_SECRET;
  if (!discordClientId || !discordClientSecret || !secret || !publicOrigin) return undefined;

  const sessionSecret = Buffer.from(secret, "base64");
  return { publicOrigin, base, discordClientId, discordClientSecret, sessionSecret, guildId };
}

/** Whether `value` is an http(s) origin exactly as a browser sends it in `Origin`. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}
