import { afterEach, describe, expect, it, vi } from "vitest";

import { call, HUB_TIMEOUT_MS } from "./api";

/** The transport's two ways of giving up on a call: its own deadline, and the caller's abort. */

/** A `fetch` that never answers until the call's signal aborts it. */
const hanging = () =>
  vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("call", () => {
  it("reports its own deadline as a timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hanging());
    const failing = call("/api/hub/x402/account", "GET");
    const caught = failing.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(HUB_TIMEOUT_MS);
    expect(await caught).toMatchObject({ code: "timeout" });
  });

  it("reports the caller's abort as aborted, not as a timeout", async () => {
    vi.stubGlobal("fetch", hanging());
    const caller = new AbortController();
    const caught = call("/api/hub/x402/account", "GET", caller.signal).catch(
      (error: unknown) => error,
    );
    caller.abort();
    expect(await caught).toMatchObject({ code: "aborted" });
  });

  it("reports a signal aborted before the call as aborted", async () => {
    vi.stubGlobal("fetch", hanging());
    const caught = call("/api/hub/x402/account", "GET", AbortSignal.abort()).catch(
      (error: unknown) => error,
    );
    expect(await caught).toMatchObject({ code: "aborted" });
  });
});
