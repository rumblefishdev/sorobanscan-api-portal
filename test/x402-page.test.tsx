import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/x402/App";

/** The one host the page links to besides sorobanscan.com: the repository's. */
const GITHUB_URL = "https://github.com/rumblefishdev/stellar-x402";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  window.history.pushState(null, "", "/");
  document.head.querySelectorAll("title").forEach((title) => title.remove());
});

const at = (path = "/api/x402-facilitator/") => {
  window.history.pushState(null, "", path);
  return render(<App />);
};
const headings = () => screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent);

it("has one top heading on the landing page, its promise", () => {
  at();
  expect(headings()).toEqual(["Get your API found by AI agents"]);
});

it("names the page in the document's title, in place of the hub's", () => {
  // As the shared `index.html` has it: the hub's title, which the page's must replace.
  const hubTitle = document.createElement("title");
  hubTitle.textContent = "Soroban Scan APIs";
  document.head.appendChild(hubTitle);
  at();
  expect(document.title).toBe("x402 Facilitator for Stellar");
});

it("points every in-page link at a part of the page", () => {
  const { container } = at();
  const targets = [...container.querySelectorAll('a[href^="#"]')].map((a) =>
    a.getAttribute("href")!.slice(1),
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const id of new Set(targets)) expect(container.querySelector(`[id="${id}"]`)).not.toBeNull();
});

it("names every section with a heading that exists", () => {
  const { container } = at();
  for (const section of container.querySelectorAll("section[aria-labelledby]")) {
    const id = section.getAttribute("aria-labelledby")!;
    expect(section.querySelector(`[id="${id}"]`)).not.toBeNull();
  }
});

it("puts an example in the search box when it is picked", () => {
  at();
  fireEvent.click(screen.getByRole("button", { name: "Weather forecast" }));
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Weather forecast");
});

it("sends every Get API Key to the hub's sign-in, in the same tab", () => {
  at();
  const links = screen.getAllByRole("link", { name: "Get API Key" });
  expect(links.length).toBeGreaterThan(1);
  for (const link of links) {
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/api/login?from=x402");
    expect(link.getAttribute("target")).toBeNull();
  }
  expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();
});

// The top bar's button says what it does (akot, 2026-11-19): it opens the hub's sign-in, where the
// key is one press further on. The page's own "Get API Key" buttons keep their words.
it("offers Log in in the top bar, to the hub's sign-in", () => {
  at();
  const bar = within(screen.getByRole("navigation", { name: "Main" }));
  const logIn = bar.getByRole("link", { name: "Log in" });
  expect(logIn.getAttribute("href")).toBe("/api/login?from=x402");
  expect(logIn.getAttribute("target")).toBeNull();
  expect(logIn.className).toBe("btn btn-primary");
  expect(bar.queryByRole("link", { name: "Get API Key" })).toBeNull();
});

// As the Prices API portal draws its own two (akot, 2026-11-19): the arrow in a disc after the
// words, which a screen reader doesn't read.
it("draws Get API Key and View documentation with the arrow of the Prices API portal's", () => {
  at();
  const calls = [
    ...screen.getAllByRole("link", { name: "Get API Key" }),
    ...screen.getAllByRole("link", { name: "View documentation" }),
  ];
  expect(screen.getAllByRole("link", { name: "View documentation" }).length).toBeGreaterThan(0);
  // The API reference, as the Prices API portal's "View documentation" opens its own: the
  // in-page quick start is the top bar's "Quickstart".
  for (const docs of screen.getAllByRole("link", { name: "View documentation" })) {
    expect(docs.getAttribute("href")).toBe("/api/docs/x402");
  }
  for (const call of calls) {
    const badge = call.querySelector(".arrow-badge");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(call.classList.contains("btn-arrow")).toBe(true);
  }
});

it("names no route of this page in the key card", () => {
  const { container } = at();
  const card = container.querySelector(".key-card");
  expect(card).not.toBeNull();
  expect(card!.querySelector("a")).toBeNull();
  expect(card!.innerHTML).not.toMatch(/\/login|\/dashboard/);
});

it.each(["/api/x402-facilitator", "/api/x402-facilitator/login", "/api/x402-facilitator/anything"])(
  "shows the landing page at %s",
  (path) => {
    at(path);
    expect(headings()).toEqual(["Get your API found by AI agents"]);
  },
);

it("has the footer's way back to the explorer, the Prices API and the hub", () => {
  at();
  const footer = within(screen.getByRole("navigation", { name: "Footer" }));
  for (const [name, href] of [
    ["Soroban Scan", "/"],
    ["Prices API", "/api/prices-api/"],
    ["All APIs", "/api/"],
    ["GitHub", GITHUB_URL],
  ] as const) expect(footer.getByRole("link", { name }).getAttribute("href")).toBe(href);
});

// A build for another prefix is the whole app there (`VITE_BASE_PATH`): a link that stayed under
// `/api/` would take the visitor out of it, to whatever production serves at that address.
describe.each(["/api/", "/api/next/"])("the page in a bundle built for %s", (base) => {
  /** The page as that bundle has it: `src/links.ts` reads the prefix when it loads. */
  const renderFor = async () => {
    vi.stubEnv("BASE_URL", base);
    vi.resetModules();
    const { App: Page } = await import("../src/x402/App");
    window.history.pushState(null, "", `${base}x402-facilitator/`);
    return render(<Page />);
  };

  it("links only under the prefix, to the explorer, to GitHub or within itself", async () => {
    const { container } = await renderFor();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href.startsWith("#") || href === "/" || href === GITHUB_URL) continue;
      expect(href.startsWith(base), href).toBe(true);
    }
  });

  it("sends the sign-in, the Prices API and All APIs to the bundle's own pages", async () => {
    await renderFor();
    for (const link of screen.getAllByRole("link", { name: "Get API Key" }))
      expect(link.getAttribute("href")).toBe(`${base}login?from=x402`);
    const footer = within(screen.getByRole("navigation", { name: "Footer" }));
    expect(footer.getByRole("link", { name: "Prices API" }).getAttribute("href")).toBe(
      `${base}prices-api/`,
    );
    expect(footer.getByRole("link", { name: "All APIs" }).getAttribute("href")).toBe(base);
  });
});

// Facts on production, 2026-11-23: the facilitator is x402-facilitator.sorobanscan.com, it lists
// only stellar:testnet, `/discovery/search` and `/mcp` answer 404, pubnet's `/verify` refuses a
// call without a key and pubnet is not open, rate limits are per address, and the price is not
// decided. What the design shows that isn't live keeps its place, marked Soon (akot, 2026-11-23).
describe("what the page claims", () => {
  const text = () => document.body.textContent ?? "";
  /** The text of the row, tile or heading a Soon tag sits in. */
  const taggedIn = (selector: string) =>
    [...document.querySelectorAll(selector)]
      .filter((element) => element.querySelector(".soon")?.textContent === "Soon")
      .map((element) => element.textContent);

  it("shows none of the design's placeholders and no address the facilitator doesn't have", () => {
    at();
    for (const placeholder of ["[PRICE]", "[USED]", "[QUOTA]", "[PRICING", "[YOUR_KEY_PREFIX]"])
      expect(text()).not.toContain(placeholder);
    expect(text()).not.toMatch(/\[[A-Za-z_][^\]\n]*\]/);
    expect(text()).not.toContain("api.sorobanscan.com");
    expect(text()).not.toMatch(/per key/i);
  });

  it("is live on testnet and says mainnet comes soon", () => {
    at();
    expect(screen.getByText("Live on Stellar Testnet · Mainnet soon")).toBeTruthy();
    expect(text()).not.toMatch(/Live on Stellar Mainnet/);
    expect(text()).not.toContain("One key works on mainnet and testnet");
  });

  it("tags every part that is not live, and only those", () => {
    at();
    expect(screen.getByRole("heading", { level: 2, name: "Search our Bazaar Soon" })).toBeTruthy();
    expect(taggedIn("#bazaar h3")).toEqual([
      "Ranked by successful purchases Soon",
      "Found in plain language Soon",
    ]);
    expect(taggedIn(".compare tbody tr")).toEqual([
      "Ranking by volume of successful purchases—Soon",
      "Plain-language search for agents—Soon",
      "MCP server: search and pay from the agent loop—Soon",
    ]);
    expect(taggedIn(".endpoints li")).toEqual([
      "GET/discovery/searchSoonPlain-language search, ranked",
      "POST/mcpSoonSearch and pay from agents",
    ]);
    expect(taggedIn("#endpoints .tile")).toEqual(["stellar:pubnetSoon"]);
    expect(taggedIn("#get-key h3")).toEqual(["Monitor usage Soon"]);
    expect(taggedIn(".key-card .tile")).toEqual(["stellar:pubnetSoonsettlements this month"]);
    // Eleven in all: the ones above, and none anywhere else.
    expect(document.querySelectorAll(".soon")).toHaveLength(11);
  });

  it("keeps what is live untagged", () => {
    at();
    const tile = (name: string) =>
      [...document.querySelectorAll("#endpoints .tile")].find(
        (element) => element.querySelector("code")?.textContent === name,
      );
    expect(tile("stellar:testnet")?.textContent).toBe("stellar:testnetLive · free");
    expect(tile("stellar:testnet")?.querySelector(".state.live")).not.toBeNull();
    for (const path of ["/supported", "/verify", "/settle", "/discovery/resources"]) {
      const row = [...document.querySelectorAll(".endpoints li")].find(
        (li) => li.querySelector("code")?.textContent === path,
      );
      expect(row?.querySelector(".soon"), path).toBeNull();
    }
  });

  it("says the Bazaar can be browsed today, and search and ranking come later", () => {
    at();
    const foot = document.querySelector(".search-foot")!.textContent;
    expect(foot).toContain("/discovery/search and our MCP server is coming");
    expect(foot).toContain("browse every listing at /discovery/resources");
  });

  it("prices mainnet as Soon and keeps testnet free", () => {
    at();
    const stat = (label: string) =>
      [...document.querySelectorAll(".stat")].find(
        (card) => card.querySelector("span")?.textContent === label,
      );
    expect(stat("Mainnet")?.querySelector(".figure")?.textContent).toBe("Soon");
    expect(stat("Testnet")?.querySelector(".figure")?.textContent).toBe("$0");
  });

  it("shows code that works on testnet today, against the facilitator's own host, with no key", () => {
    at();
    const quickstart = document.getElementById("quickstart")!;
    const code = [...quickstart.querySelectorAll("pre")].map((pre) => pre.textContent).join("\n");
    expect(code).toContain('url: "https://x402-facilitator.sorobanscan.com"');
    expect(code).toContain('.register("stellar:testnet"');
    expect(code).not.toContain("stellar:pubnet");
    expect(code).not.toMatch(/Authorization|API_KEY|createAuthHeaders/);
    const example = document.getElementById("endpoints")!.querySelector("pre")!.textContent;
    expect(example).toContain('"network": "stellar:testnet"');
  });

  it("answers the network, key, ranking and price questions as things are", () => {
    at();
    const answer = (question: string) =>
      screen.getByText(question).closest("details")!.querySelector("p")!.textContent;
    expect(answer("Mainnet or testnet?")).toMatch(/^Testnet today, mainnet soon, on the same host\./);
    expect(answer("How do I get an API key?")).toContain(
      "It is for mainnet, which opens soon; testnet needs no key.",
    );
    expect(answer("How is the ranking decided?")).toMatch(/^Ranking is coming soon\./);
    expect(answer("What does it cost on mainnet?")).toMatch(/^Mainnet pricing is coming soon\./);
    expect(answer("How do I get listed?")).toContain(
      "/discovery/resources now, and in /discovery/search and the MCP server when they open",
    );
  });
});
