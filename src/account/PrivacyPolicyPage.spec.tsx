import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

/**
 * `/privacy-policy` (`PrivacyPolicyPage.tsx`): the policy, a page of the account tree since
 * 2026-11-20 and open to everybody. It was the Prices portal's own, at
 * `/api/prices-api/privacy-policy`, which now sends the browser here. The policy's text and what
 * the page draws of it are `src/prices/privacy/PrivacyPolicy.spec.tsx`'s; this holds the page
 * around it.
 */

const renderAt = (path: string) =>
  render(
    <MemoryRouter basename="/api" initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

const SIGNED_IN = { authenticated: true, id: "80351110224678912", username: "nelly" };
const SIGNED_OUT = { authenticated: false };

function stubMe(me: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      if (url === "/api/hub/me") return Response.json(me);
      throw new Error(`unexpected request to ${String(url)}`);
    }),
  );
}

const policyHeading = () => screen.findByRole("heading", { level: 1, name: /privacy policy/i });
const meta = (name: string) =>
  document.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
const canonical = () =>
  document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the privacy policy page", () => {
  it.each(["/api/privacy-policy", "/api/privacy-policy?from=prices"])(
    "shows the policy under the hub's bar to a visitor, at %s",
    async (path) => {
      stubMe(SIGNED_OUT);
      renderAt(path);
      expect(await policyHeading()).toBeTruthy();
      const bar = within(await screen.findByRole("navigation", { name: "Documentation" }));
      expect(bar.getByRole("link", { name: "Log in" })).toBeTruthy();
    },
  );

  it.each(["/api/privacy-policy", "/api/privacy-policy?from=prices"])(
    "shows the signed-in bar to an account, at %s",
    async (path) => {
      stubMe(SIGNED_IN);
      renderAt(path);
      expect(await policyHeading()).toBeTruthy();
      const bar = within(await screen.findByRole("navigation", { name: "Dashboard" }));
      expect(bar.getByText("nelly")).toBeTruthy();
      expect(bar.getByRole("button", { name: "Sign out" })).toBeTruthy();
      expect(bar.queryByRole("link", { name: "Log in" })).toBeNull();
    },
  );

  /**
   * ⚠️ Every non-current link in a signed-in bar was `display: none` at `xs`, so on a phone the bar
   * showed only where the visitor already was. The 375 px criterion is about being usable, not
   * merely about fitting. (Held on the old portal's signed-in bar over this page until 2026-11-20.)
   */
  it("keeps every signed-in destination reachable, at any width", async () => {
    stubMe(SIGNED_IN);
    renderAt("/api/privacy-policy");
    await policyHeading();
    const bar = within(await screen.findByRole("navigation", { name: "Dashboard" }));
    for (const name of [/^dashboard$/i, /openapi docs/i, /quick start/i]) {
      const link = bar.getByRole("link", { name });
      expect(getComputedStyle(link).display, String(name)).not.toBe("none");
    }
  });

  it("draws the footer, whose Privacy policy link is the page's own address", async () => {
    stubMe(SIGNED_OUT);
    renderAt("/api/privacy-policy");
    await policyHeading();
    const footer = within(screen.getByRole("navigation", { name: "Footer" }));
    expect(footer.getByRole("link", { name: /^privacy policy$/i }).getAttribute("href")).toBe(
      "/api/privacy-policy",
    );
  });

  it("offers the dashboard in the footer to an account, and not to a visitor", async () => {
    stubMe(SIGNED_IN);
    const account = renderAt("/api/privacy-policy");
    await policyHeading();
    await screen.findByRole("navigation", { name: "Dashboard" });
    const link = () =>
      within(screen.getByRole("navigation", { name: "Footer" })).queryByRole("link", {
        name: "Dashboard",
      });
    expect(link()?.getAttribute("href")).toBe("/api/dashboard/prices");
    account.unmount();

    stubMe(SIGNED_OUT);
    renderAt("/api/privacy-policy");
    await policyHeading();
    await screen.findByRole("navigation", { name: "Documentation" });
    expect(link()).toBeNull();
  });

  it.each(["/api/privacy-policy", "/api/privacy-policy?from=prices"])(
    "is written to be found, and says where it lives, at %s",
    async (path) => {
      stubMe(SIGNED_OUT);
      renderAt(path);
      await policyHeading();
      await waitFor(() => expect(document.title).toMatch(/privacy policy/i));
      expect(meta("robots")).toBeNull();
      // No query: one address for the page, whatever brought the reader.
      expect(canonical()).toBe(`${window.location.origin}/api/privacy-policy`);
    },
  );

  it("adds x402's paragraph when the build turns x402 on", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices,x402");
    stubMe(SIGNED_OUT);
    renderAt("/api/privacy-policy");
    await policyHeading();
    expect(screen.getByRole("heading", { level: 2, name: /x402 Facilitator API keys/ })).toBeTruthy();
  });

  it("leaves x402's paragraph out when only Prices is on", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices");
    stubMe(SIGNED_OUT);
    renderAt("/api/privacy-policy");
    await policyHeading();
    expect(screen.queryByRole("heading", { name: /x402 Facilitator API keys/ })).toBeNull();
  });
});
