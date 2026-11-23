import { afterEach, describe, expect, it, vi } from "vitest";

/** `src/links.ts` as a bundle built for `base` reads it. */
async function linksAt(base: string) {
  vi.stubEnv("BASE_URL", base);
  vi.resetModules();
  return import("../src/links");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the hub's links", () => {
  it("are production's addresses in a build for /api/", async () => {
    const links = await linksAt("/api/");
    expect(links.HUB_URL).toBe("/api/");
    expect(links.PRICES_API_URL).toBe("/api/prices-api/");
    expect(links.LOGIN_URL).toBe("/api/login");
    expect(links.X402_LOGIN_URL).toBe("/api/login?from=x402");
    expect(links.QUICK_START_URL).toBe("/api/quick-start/prices");
    expect(links.X402_URL).toBe("/api/x402-facilitator/");
    expect(links.DOCS_URL).toBe("/api/docs/prices");
  });

  // A build for another prefix is the whole app at that prefix (`VITE_BASE_PATH`). A link that
  // stayed under `/api/` would take the visitor out of it, to whatever production serves there.
  it("keep this bundle's own pages under the prefix it was built for", async () => {
    const links = await linksAt("/api/next/");
    expect(links.HUB_URL).toBe("/api/next/");
    expect(links.PRICES_API_URL).toBe("/api/next/prices-api/");
    expect(links.LOGIN_URL).toBe("/api/next/login");
    expect(links.X402_LOGIN_URL).toBe("/api/next/login?from=x402");
    expect(links.QUICK_START_URL).toBe("/api/next/quick-start/prices");
    expect(links.X402_URL).toBe("/api/next/x402-facilitator/");
    expect(links.DOCS_URL).toBe("/api/next/docs/prices");
  });

  it("leave the other apps of the site where they are, whatever the prefix", async () => {
    const links = await linksAt("/api/next/");
    expect(links.EXPLORER_URL).toBe("/");
  });
});
