import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it } from "vitest";
import { App } from "../src/App";

afterEach(cleanup);

/** The page at `path`, under the prefix the browser's router gets from `/api/`. */
const renderAt = (path: string) =>
  render(
    <MemoryRouter basename="/api" initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

it("shows the hub at the prefix and at an address it doesn't know", () => {
  for (const path of ["/api/", "/api/anything/else"]) {
    const { unmount } = renderAt(path);
    expect(
      screen.getByRole("heading", { level: 1, name: "Stellar data and payments, as APIs" }),
    ).toBeTruthy();
    unmount();
  }
});

// The design has three navigations (the top bar's, the hero's directory and the footer's), so
// the top bar's is found by its name.
it("has the design's top bar", () => {
  renderAt("/api/");
  const nav = screen.getByRole("navigation", { name: "Main" });
  for (const [name, href] of [
    ["Products", "#products"],
    ["Which API?", "#choose"],
    ["How they connect", "#stack"],
    ["FAQ", "#faq"],
    ["Explorer", "/"],
  ] as const) expect(within(nav).getByRole("link", { name }).getAttribute("href")).toBe(href);
  expect(within(nav).queryByRole("link", { name: /log ?in|sign ?in|dashboard/i })).toBeNull();
});

it("lists the three products in the hero's terminal", () => {
  renderAt("/api/");
  expect(screen.getByText("2 APIs live · 1 coming soon")).toBeTruthy();
  for (const [name, href] of [
    ["prices-api/", "/api/prices-api/"],
    ["x402-facilitator/", "/api/x402-facilitator/"],
    ["sorobanscan-api/", "#soroban-scan-api"],
  ] as const) expect(screen.getByRole("link", { name: new RegExp(name) }).getAttribute("href")).toBe(href);
});

it("has the design's footer", () => {
  renderAt("/api/");
  const footer = screen.getByRole("contentinfo");
  expect(within(footer).getByText("Soroban Scan APIs by Rumble Fish")).toBeTruthy();
  for (const name of ["Soroban Scan", "Prices API", "x402 Facilitator", "GitHub"])
    expect(within(footer).getByRole("link", { name })).toBeTruthy();
});
