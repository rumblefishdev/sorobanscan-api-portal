import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  BASE_URL,
  DOCUMENTED_PATHS,
  JSON_SNIPPETS,
  SECTIONS,
  SNIPPETS,
  X402QuickStart,
} from "./X402QuickStart";

/** The guide under the router the account pages give it: basename `/api`. */
const renderGuide = () =>
  render(
    <MemoryRouter basename="/api" initialEntries={["/api/quick-start/x402"]}>
      <X402QuickStart />
    </MemoryRouter>,
  );

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const hrefs = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

afterEach(cleanup);

describe("the x402 quick start", () => {
  it("has one headline and a heading for every section its rail lists", () => {
    renderGuide();
    expect(
      screen.getByRole("heading", { level: 1, name: "Take x402 payments on Stellar" }),
    ).toBeTruthy();
    for (const { id, label } of SECTIONS) {
      const heading = screen.getByRole("heading", { level: 2, name: label });
      // The rail's `#id` lands on the section's title block.
      expect(document.getElementById(id)?.contains(heading)).toBe(true);
    }
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(SECTIONS.length);
  });

  it("links to the reference, the dashboard's tab and the sign-in, under the pages' prefix", () => {
    renderGuide();
    const links = hrefs();
    expect(links).toContain("/api/docs/x402");
    expect(links).toContain("/api/dashboard/x402");
    expect(links).toContain("/api/login?from=x402");
    expect(links).toContain("https://github.com/rumblefishdev/stellar-x402");
  });

  it("names the facilitator's own host, and aims a key at no other", () => {
    renderGuide();
    expect(BASE_URL).toBe("https://x402-facilitator.sorobanscan.com");
    const strip = screen.getByText("Base URL", { selector: "p" }).parentElement!;
    expect(within(strip).getByText(BASE_URL)).toBeTruthy();
    // Every address a snippet calls is the facilitator's, or the seller's own machine.
    const called = Object.values(SNIPPETS).flatMap(
      ({ text }) => text.match(/https?:\/\/[^"\s`]+/g) ?? [],
    );
    expect(called.length).toBeGreaterThan(0);
    for (const url of called) {
      expect(url.startsWith(BASE_URL) || url.startsWith("http://localhost:4021/")).toBe(true);
    }
  });

  it("says a key is for stellar:pubnet only, as a bearer token", () => {
    renderGuide();
    const section = document.getElementById("authentication")!.parentElement!;
    expect(section.textContent).toMatch(/only for stellar:pubnet/);
    expect(within(section).getByText("Authorization: Bearer YOUR_API_KEY")).toBeTruthy();
    expect(section.textContent).toMatch(/missing_api_key/);
    expect(section.textContent).toMatch(/invalid_api_key/);
  });

  // What the facilitator doesn't have, and what isn't decided: none of it may be promised here.
  it.each([
    ["a search endpoint", /discovery\/search/i],
    ["an MCP endpoint", /\/mcp\b/i],
    ["mainnet as live", /mainnet is live|live on (stellar )?mainnet|now on mainnet/i],
    ["a free quota or tier", /free (tier|quota|plan)|requests\s*\/\s*mo|per month/i],
    ["a fee per settlement", /fee per settlement|\d+(\.\d+)?\s*% /i],
    ["an internal task or decision id", /\b(task|ADR|decision)\s+\d+|\b0\d{3}\b/i],
    ["another host for the API", /api\.sorobanscan\.com/i],
  ])("does not claim %s", (_what, claim) => {
    const { container } = renderGuide();
    expect(container.textContent).not.toMatch(claim);
  });

  it("states one price only, the example route's own", () => {
    const { container } = renderGuide();
    expect(container.textContent?.match(/\$\d[\d.]*/g)).toEqual(["$0.001", "$0.001"]);
  });

  it("names only paths the facilitator serves", () => {
    const { container } = renderGuide();
    // Every `/discovery…` it names: the route itself, or the bare prefix its rate limit is for.
    const text = container.textContent ?? "";
    const discovery = new Set(text.match(/\/discovery(?:\/[a-z]+)?/g));
    expect([...discovery].sort()).toEqual(["/discovery", "/discovery/resources"]);
    const named = new Set(text.match(/\/(verify|settle|supported|discovery\/resources|health)\b/g));
    expect([...named].sort()).toEqual([...DOCUMENTED_PATHS].sort());
  });
});

/**
 * A snippet's view is cut from its text, so the two can't differ in what they say; this holds the
 * cutting to that, as Prices' spec holds its hand-written pairs.
 */
describe("the x402 quick start's snippets", () => {
  const all = Object.entries({ ...SNIPPETS, ...JSON_SNIPPETS });

  it("has snippets to check", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all)("%s renders the code its Copy button writes", (_name, snippet) => {
    const { container } = render(<pre>{snippet.view}</pre>);
    expect(container.textContent).toBe(snippet.text);
    expect(collapse(snippet.text)).not.toBe("");
  });

  it.each(Object.entries(JSON_SNIPPETS))("%s is JSON", (_name, snippet) => {
    expect(() => JSON.parse(snippet.text)).not.toThrow();
  });

  it("colours a quoted address as a string, never as a comment", () => {
    const { container } = render(<pre>{SNIPPETS.SUPPORTED_REQUEST.view}</pre>);
    const runs = [...container.querySelectorAll("span")].map((span) => span.textContent);
    expect(runs).toEqual(["curl", `"${BASE_URL}/supported"`]);
  });

  it("gives /verify and /settle one body: version 2, the payment and its requirements", () => {
    const body = JSON.parse(JSON_SNIPPETS.PAYMENT_REQUEST.text) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["x402Version", "paymentPayload", "paymentRequirements"]);
    expect(body.x402Version).toBe(2);
    const payload = body.paymentPayload as { accepted: unknown };
    expect(payload.accepted).toEqual(body.paymentRequirements);
    expect((body.paymentRequirements as { amount: string }).amount).toMatch(/^\d+$/);
  });
});
