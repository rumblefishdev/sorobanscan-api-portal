import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAccountPath, isPricesPath } from "../src/boot.js";

// Each tree's entry renders at import. Here they stand in with a word in `#root`, so a test sees
// which tree the address booted, and that the sign-in popup booted none. `vi.mock` covers the
// import above; `standIn` registers them again for each fresh load below, since a factory runs
// once per registration.
const standIn = (tree: string) => () => {
  document.getElementById("root")?.append(tree);
  return {};
};
vi.mock("../src/hub/main.tsx", () => ({}));
vi.mock("../src/prices/main.tsx", () => ({}));
vi.mock("../src/account/main.tsx", () => ({}));

describe("isPricesPath", () => {
  it.each([
    "/api/prices-api",
    "/api/prices-api/",
    "/api/prices-api/dashboard",
    "/api/prices-api/docs",
  ])("boots Prices for %s", (p) => expect(isPricesPath(p, "/api/")).toBe(true));
  it.each([
    "/api/",
    "/api",
    "/api/prices-apiX",
    "/api/prices",
    "/api/x402-facilitator/",
    "/api/anything",
    "/api/privacy-policy",
  ])("boots the hub for %s", (p) => expect(isPricesPath(p, "/api/")).toBe(false));
  it("follows another base", () =>
    expect(isPricesPath("/api/next/prices-api/", "/api/next/")).toBe(true));
});

describe("isAccountPath", () => {
  it.each([
    "/api/login",
    "/api/dashboard",
    "/api/dashboard/prices",
    "/api/dashboard/x402",
    "/api/quick-start",
    "/api/quick-start/prices",
    "/api/docs",
    "/api/docs/x402",
    "/api/privacy-policy",
  ])(
    "boots the account pages for %s",
    (p) => expect(isAccountPath(p, "/api/")).toBe(true),
  );
  it.each([
    "/api/loginX",
    "/api/dashboardX",
    "/api/quick-startX",
    "/api/docsX",
    "/api/privacy-policyX",
    "/api/privacy-policy/extra",
    "/api/prices-api/quick-start",
    "/api/prices-api/docs",
    "/api/",
    "/api",
    "/api/prices-api/login",
    "/api/prices-api/dashboard",
    "/login",
    "/dashboard",
  ])("leaves %s to another tree", (p) => expect(isAccountPath(p, "/api/")).toBe(false));
  it("follows another base", () => {
    expect(isAccountPath("/api/next/login", "/api/next/")).toBe(true);
    expect(isAccountPath("/api/login", "/api/next/")).toBe(false);
  });
});

describe("the boot module", () => {
  const root = () => document.getElementById("root");
  const postMessage = vi.fn();

  /** Loads the module afresh at `path`, as a page load there does, and waits for its import. */
  const boot = async (path: string) => {
    window.history.pushState({}, "", path);
    await import("../src/boot.js");
    await vi.dynamicImportSettled();
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../src/hub/main.tsx", standIn("the hub"));
    vi.doMock("../src/prices/main.tsx", standIn("Prices"));
    vi.doMock("../src/account/main.tsx", standIn("the account"));
    postMessage.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(window, "close").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "opener", { value: null, configurable: true, writable: true });
    window.name = "";
    window.history.pushState({}, "", "/");
    document.body.innerHTML = "";
  });

  // The base is the config's, `/api/`.
  it.each([
    ["/api/", "the hub"],
    ["/api/prices-apiX", "the hub"],
    ["/api/prices-api", "Prices"],
    ["/api/prices-api/dashboard", "Prices"],
    ["/api/login", "the account"],
    ["/api/login?signin=not_member", "the account"],
    ["/api/dashboard", "the account"],
    ["/api/dashboard/prices", "the account"],
    ["/api/loginX", "the hub"],
    ["/api/prices-api/login", "Prices"],
  ])("at %s boots %s", async (path, tree) => {
    await boot(path);
    expect(root()?.textContent).toBe(tree);
  });

  describe("in the Discord sign-in popup", () => {
    const opener = (value: unknown) =>
      Object.defineProperty(window, "opener", { value, configurable: true, writable: true });

    it("hands the outcome to the opener, closes and mounts nothing", async () => {
      opener({ postMessage });
      window.name = "stellar-portal-oauth";
      await boot("/api/prices-api/?signin=cancelled");

      expect(postMessage).toHaveBeenCalledExactlyOnceWith(
        { source: "stellar-portal-oauth", search: "?signin=cancelled" },
        window.location.origin,
      );
      expect(window.close).toHaveBeenCalledOnce();
      expect(root()?.textContent).toBe("");
    });

    it("boots the page when the window has no opener", async () => {
      opener(null);
      window.name = "stellar-portal-oauth";
      await boot("/api/prices-api/?signin=cancelled");

      expect(window.close).not.toHaveBeenCalled();
      expect(root()?.textContent).toBe("Prices");
    });

    it("tells the opener nothing when the window isn't the popup", async () => {
      opener({ postMessage });
      await boot("/api/prices-api/?signin=cancelled");

      expect(postMessage).not.toHaveBeenCalled();
      expect(window.close).not.toHaveBeenCalled();
      expect(root()?.textContent).toBe("Prices");
    });
  });
});
