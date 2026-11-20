/*
 * The hub's backend as an AWS Lambda behind a function URL (payload format 2.0). Its settings are
 * read once per instance (`lambda-settings.ts`); while they can't be, every request is answered
 * 503 `sign_in_not_configured` (`createHub(undefined)`), and the next read waits
 * {@link FAILURE_TTL_MS}. Nothing of a secret is logged.
 */
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { handle } from "hono/aws-lambda";
import { createHub } from "./app.ts";
import { loadLambdaSettings } from "./lambda-settings.ts";
import { FAILURE_TTL_MS, SECRET_READ_DEADLINE_MS, secretsManager } from "./product-secret.ts";

type Served = ReturnType<typeof handle>;

/** Secrets Manager's text for `name`, within the deadline the product secret's read has. */
function readFromAws(): (name: string) => Promise<string> {
  const client = secretsManager();
  return async (name) => {
    const cancel = new AbortController();
    const timer = setTimeout(() => cancel.abort(), SECRET_READ_DEADLINE_MS);
    try {
      const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: name }), {
        abortSignal: cancel.signal,
      });
      if (typeof SecretString !== "string") throw new Error("no text");
      return SecretString;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The function's handler. `read` and `now` are the tests'; the function uses Secrets Manager and
 * the clock.
 */
export function createLambdaHandler(
  deps: { read?: (name: string) => Promise<string>; now?: () => number } = {},
): Served {
  const now = deps.now ?? Date.now;
  let read = deps.read;
  const unconfigured = handle(createHub(undefined));
  let loading: { served: Promise<Served>; failedAt?: number } | undefined;

  const load = (): Promise<Served> => {
    const entry: NonNullable<typeof loading> = {
      served: (async () => {
        read ??= readFromAws();
        return handle(createHub(await loadLambdaSettings(process.env, read)));
      })().catch((error: unknown) => {
        entry.failedAt = now();
        console.error(`startup_failed ${error instanceof Error ? error.message : "unknown"}`);
        return unconfigured;
      }),
    };
    loading = entry;
    return entry.served;
  };

  const current = (): Promise<Served> =>
    loading && (loading.failedAt === undefined || now() < loading.failedAt + FAILURE_TTL_MS)
      ? loading.served
      : load();

  return (async (event, context) => (await current())(event, context)) as Served;
}

export const handler = createLambdaHandler();
