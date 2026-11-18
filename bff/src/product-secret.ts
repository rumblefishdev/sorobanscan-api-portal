/*
 * The secret the hub's tokens to a product are signed with (the shared sign-in spec's decision
 * 12): JSON `{"current": <base64 of 32 bytes>, "previous"?: …}` in AWS Secrets Manager, read
 * through the AWS SDK's default credentials (an `AWS_PROFILE` locally, the backend's role in AWS).
 * The hub signs with `current` only; `previous` is the product's, so the secret can be changed
 * without a gap. The secret is never logged and never put in an error.
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
  type GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import { SECRET_BYTES } from "./token.ts";

/** Where the secret is kept. */
const SECRET_REGION = "eu-central-1";
/** How long a secret read is used before it is read again: a new `current` is taken up by then. */
export const SECRET_TTL_MS = 5 * 60 * 1000;
/** How long a failed read is answered from memory, so a burst of calls doesn't each wait on AWS. */
export const FAILURE_TTL_MS = 10 * 1000;
/**
 * How long a read may take, credentials included, before it counts as failed. The client's own
 * timeouts cover the request to Secrets Manager, not the credential chain before it (an SSO
 * profile, a metadata endpoint), and a read that never settled would be shared by every later call.
 */
export const SECRET_READ_DEADLINE_MS = 15 * 1000;

/** The part of Secrets Manager's client the secret is read through; a fake in the tests. */
export interface SecretsClient {
  send(
    command: GetSecretValueCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Pick<GetSecretValueCommandOutput, "SecretString">>;
}

/** Why a secret couldn't be had. Its message names the secret and the reason, never a value. */
export class ProductSecretError extends Error {
  override readonly name = "ProductSecretError";
}

/**
 * Secrets Manager in {@link SECRET_REGION}, whatever region the credentials name, with the
 * SDK's default credentials. Timeouts of its own, since the SDK has none: an endpoint out of reach
 * fails in seconds and doesn't hold every call to the product.
 */
export function secretsManager(): SecretsClient {
  return new SecretsManagerClient({
    region: SECRET_REGION,
    maxAttempts: 2,
    requestHandler: {
      connectionTimeout: 3_000,
      requestTimeout: 5_000,
      throwOnRequestTimeout: true,
    },
  });
}

/**
 * The current value of the secret named `name`: 32 bytes, read from Secrets Manager at the first
 * call and kept for {@link SECRET_TTL_MS}. Calls while a read is under way share it. A read that
 * fails, with no credentials, no access, a malformed secret or no answer in
 * {@link SECRET_READ_DEADLINE_MS}, rejects with a {@link ProductSecretError}, is logged once here
 * as `product_secret_unavailable`, and is answered so for at most {@link FAILURE_TTL_MS}; the next
 * call after reads again.
 *
 * `client` is made at the first read unless given, so nothing asks AWS until a secret is needed.
 */
export function productSecret(
  name: string,
  client?: SecretsClient,
  now: () => number = Date.now,
): () => Promise<Buffer> {
  let cached: { value: Promise<Buffer>; until: number } | undefined;

  const unavailable = (reason: string) =>
    new ProductSecretError(
      `The secret ${name} in AWS Secrets Manager (${SECRET_REGION}) ${reason}`,
    );

  /**
   * Secrets Manager's answer, or a {@link ProductSecretError} once the deadline has passed, which
   * also cancels the request: the SDK would otherwise hold it until its own timeouts.
   */
  async function fetchText(): Promise<string | undefined> {
    client ??= secretsManager();
    const cancel = new AbortController();
    const asked = client.send(new GetSecretValueCommand({ SecretId: name }), {
      abortSignal: cancel.signal,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(unavailable(`could not be read in ${SECRET_READ_DEADLINE_MS / 1000} s`));
        cancel.abort();
      }, SECRET_READ_DEADLINE_MS);
    });
    try {
      return (await Promise.race([asked, deadline])).SecretString;
    } finally {
      clearTimeout(timer);
    }
  }

  async function read(): Promise<Buffer> {
    let text: string | undefined;
    try {
      text = await fetchText();
    } catch (error) {
      if (error instanceof ProductSecretError) throw error;
      // By name only: the SDK's message can carry the caller's ARN, and nothing of it says more.
      throw unavailable(`could not be read: ${error instanceof Error ? error.name : "a failure"}`);
    }
    if (typeof text !== "string") throw unavailable("holds no text");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not the parser's message: it quotes the text it failed on.
      throw unavailable("is not JSON");
    }
    const current =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as { current?: unknown }).current
        : undefined;
    if (typeof current !== "string") throw unavailable('has no "current"');
    const secret = Buffer.from(current, "base64");
    // Exactly as `openssl rand -base64 32` prints it: Node decodes leniently, so it is checked
    // by writing it back.
    if (secret.length !== SECRET_BYTES || secret.toString("base64") !== current) {
      throw unavailable(`has a "current" that isn't base64 of ${SECRET_BYTES} bytes`);
    }
    return secret;
  }

  return () => {
    if (cached && now() < cached.until) return cached.value;
    const entry = { value: read(), until: Number.POSITIVE_INFINITY };
    cached = entry;
    // Registered before the caller's own `await`, so the read's lifetime is set by the time the
    // caller sees its outcome.
    entry.value.then(
      () => {
        entry.until = now() + SECRET_TTL_MS;
      },
      (error: unknown) => {
        entry.until = now() + FAILURE_TTL_MS;
        console.warn(`product_secret_unavailable ${(error as Error).message}`);
      },
    );
    return entry.value;
  };
}
