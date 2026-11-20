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
  /**
   * The name, in AWS Secrets Manager, of the secret the tokens to Prices are signed with
   * (`product-secret.ts`). Its name only: the value is read from AWS, never from a setting.
   */
  pricesTokenSecretName: string;
  /** Prices' hub contract, with no trailing slash: a call goes to `${pricesHubApi}/account`. */
  pricesHubApi: string;
  /** The name, in AWS Secrets Manager, of the secret the tokens to x402 are signed with. */
  x402TokenSecretName: string;
  /** x402's hub contract, with no trailing slash, as `pricesHubApi` is. */
  x402HubApi: string;
  /** The products whose routes answer, by name: the backend's own allowlist. */
  products: string[];
  /** How old a Discord account must be, in minutes, to be issued a key. */
  minAccountAgeMinutes: number;
  /**
   * The secret CloudFront adds to every request it sends the backend, in `X-Hub-Origin-Secret`:
   * `current`, and `previous` while it is being changed. With it, a request that carries neither
   * is refused before anything else (`createHub`). Absent, as on `pnpm dev` and `pnpm preview`,
   * there is no such check: {@link readSettings} never sets it, the Lambda's entry does.
   */
  originSecret?: { current: string; previous?: string };
};

/** Stellar Developers, the Discord server whose members may sign in. */
export const STELLAR_DEVELOPERS_GUILD = "897514728459468821";
/** Production's secret for the tokens to Prices (the shared sign-in spec's decision 12). */
const PRICES_TOKEN_SECRET_NAME = "sorobanscan-hub/production/prices-token";
/** Production Prices' hub contract. */
const PRICES_HUB_API = "https://prices-api.sorobanscan.com/api/hub/v1";
/** Production's secret for the tokens to x402. */
const X402_TOKEN_SECRET_NAME = "sorobanscan-hub/production/x402-token";
/** Production x402's hub contract. */
const X402_HUB_API = "https://x402-portal.sorobanscan.com/api/hub/v1";
/** The products this backend has routes for. */
const KNOWN_PRODUCTS: readonly string[] = ["prices", "x402"];
/** The products served when `HUB_PRODUCTS` is unset: Prices alone, x402 is opt-in. */
const DEFAULT_PRODUCTS: readonly string[] = ["prices"];
const DEFAULT_MIN_ACCOUNT_AGE_MINUTES = 5;
const MIN_SECRET_BYTES = 32;

const SNOWFLAKE = /^[0-9]{1,20}$/;
/** Standard base64 with its padding, as `openssl rand -base64 32` prints it. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** A secret's name as Secrets Manager allows one. */
const SECRET_NAME = /^[A-Za-z0-9/_+=.@-]{1,512}$/;
/** Whole minutes, up to six digits (about two years). */
const MINUTES = /^[0-9]{1,6}$/;
/** The hosts a Prices API may be on over plain HTTP: this machine's. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
 * (Stellar Developers), `HUB_PRICES_TOKEN_SECRET` (the secret's name in Secrets Manager),
 * `PRICES_HUB_API`, `HUB_X402_TOKEN_SECRET`, `X402_HUB_API`, `HUB_PRODUCTS` (a comma list,
 * `prices`) and `MIN_ACCOUNT_AGE_MINUTES` (5), each production's by default and when empty. Every
 * value present is checked first, so a malformed one throws whether or not the others are set,
 * naming the setting and never repeating a secret. Then `undefined` when one of the four is
 * missing or empty: sign-in is not configured.
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

  // Not repeated in the message: the session secret beside it is a value, and one pasted here
  // would otherwise be printed, and sent to AWS as a name.
  const pricesTokenSecretName = env.HUB_PRICES_TOKEN_SECRET || PRICES_TOKEN_SECRET_NAME;
  if (!SECRET_NAME.test(pricesTokenSecretName) || isSecretValue(pricesTokenSecretName)) {
    throw new Error(
      `HUB_PRICES_TOKEN_SECRET must be a secret's name in AWS Secrets Manager, as "${PRICES_TOKEN_SECRET_NAME}" is, not the secret's value`,
    );
  }

  // Not repeated either: a user and password in it would be printed.
  const pricesHubApi = env.PRICES_HUB_API || PRICES_HUB_API;
  if (!isApiBase(pricesHubApi)) {
    throw new Error(
      `PRICES_HUB_API must be an https URL with no user, query, fragment or trailing slash, as "${PRICES_HUB_API}" is (http on this machine only)`,
    );
  }

  const x402TokenSecretName = env.HUB_X402_TOKEN_SECRET || X402_TOKEN_SECRET_NAME;
  if (!SECRET_NAME.test(x402TokenSecretName) || isSecretValue(x402TokenSecretName)) {
    throw new Error(
      `HUB_X402_TOKEN_SECRET must be a secret's name in AWS Secrets Manager, as "${X402_TOKEN_SECRET_NAME}" is, not the secret's value`,
    );
  }

  const x402HubApi = env.X402_HUB_API || X402_HUB_API;
  if (!isApiBase(x402HubApi)) {
    throw new Error(
      `X402_HUB_API must be an https URL with no user, query, fragment or trailing slash, as "${X402_HUB_API}" is (http on this machine only)`,
    );
  }

  const productList = env.HUB_PRODUCTS || DEFAULT_PRODUCTS.join(",");
  const products = productList.split(",").map((name) => name.trim());
  if (!products.every((name) => KNOWN_PRODUCTS.includes(name))) {
    throw new Error(
      `HUB_PRODUCTS must be a comma list of the products this backend serves (${KNOWN_PRODUCTS.join(", ")}); got "${productList}"`,
    );
  }

  const age = env.MIN_ACCOUNT_AGE_MINUTES || String(DEFAULT_MIN_ACCOUNT_AGE_MINUTES);
  if (!MINUTES.test(age)) {
    throw new Error(
      `MIN_ACCOUNT_AGE_MINUTES must be a whole number of minutes, up to six digits; got "${age}"`,
    );
  }

  const discordClientId = env.DISCORD_CLIENT_ID;
  const discordClientSecret = env.DISCORD_CLIENT_SECRET;
  if (!discordClientId || !discordClientSecret || !secret || !publicOrigin) return undefined;

  const sessionSecret = Buffer.from(secret, "base64");
  return {
    publicOrigin,
    base,
    discordClientId,
    discordClientSecret,
    sessionSecret,
    guildId,
    pricesTokenSecretName,
    pricesHubApi,
    x402TokenSecretName,
    x402HubApi,
    products,
    minAccountAgeMinutes: Number(age),
  };
}

/** Whether `value` looks like a secret rather than its name: base64 of 32 bytes or more. */
const isSecretValue = (value: string) =>
  BASE64.test(value) && Buffer.from(value, "base64").length >= MIN_SECRET_BYTES;

/**
 * Whether `value` is an API's base URL to call with a token: https, or http on this machine, with
 * no user, query, fragment or trailing slash.
 */
function isApiBase(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  return (
    secure &&
    !url.username &&
    !url.password &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.endsWith("/")
  );
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
