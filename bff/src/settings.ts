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
export const DEFAULT_PUBLIC_ORIGIN = "http://localhost:5173";
const MIN_SECRET_BYTES = 32;

const SNOWFLAKE = /^[0-9]{1,20}$/;
/** Standard base64 with its padding, as `openssl rand -base64 32` prints it. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The settings from `env`: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `HUB_SESSION_SECRET`
 * (base64 of at least 32 bytes), and the optional `DISCORD_GUILD_ID` (Stellar Developers) and
 * `HUB_PUBLIC_ORIGIN` (`http://localhost:5173`). `undefined` when one of the three is missing or
 * empty: sign-in is then not configured. A value present but malformed throws, naming the setting
 * and never repeating a secret.
 */
export function readSettings(
  env: Record<string, string | undefined>,
  base: string,
): HubSettings | undefined {
  const discordClientId = env.DISCORD_CLIENT_ID;
  const discordClientSecret = env.DISCORD_CLIENT_SECRET;
  const secret = env.HUB_SESSION_SECRET;
  if (!discordClientId || !discordClientSecret || !secret) return undefined;

  if (!BASE64.test(secret) || Buffer.from(secret, "base64").length < MIN_SECRET_BYTES) {
    throw new Error(
      `HUB_SESSION_SECRET must be base64 of at least ${MIN_SECRET_BYTES} bytes, as \`openssl rand -base64 32\` prints it`,
    );
  }
  const sessionSecret = Buffer.from(secret, "base64");

  const guildId = env.DISCORD_GUILD_ID || STELLAR_DEVELOPERS_GUILD;
  if (!SNOWFLAKE.test(guildId)) {
    throw new Error(`DISCORD_GUILD_ID must be a Discord server's id, digits only; got "${guildId}"`);
  }

  const publicOrigin = env.HUB_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN;
  if (!isOrigin(publicOrigin)) {
    throw new Error(
      `HUB_PUBLIC_ORIGIN must be an origin, as "https://sorobanscan.com" is, with no path or trailing slash; got "${publicOrigin}"`,
    );
  }

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
