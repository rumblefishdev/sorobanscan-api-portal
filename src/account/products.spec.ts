import { describe, expect, it } from "vitest";

import { enabledProducts } from "./products";

describe("enabledProducts", () => {
  it.each([undefined, "", " ", ","])("is Prices alone when the setting is %j", (setting) =>
    expect(enabledProducts(setting)).toEqual(["prices"]),
  );

  it.each([
    ["prices", ["prices"]],
    ["prices,x402", ["prices", "x402"]],
    // In the dashboard's order, whatever the setting's, and each once.
    ["x402,prices", ["prices", "x402"]],
    [" x402 , prices ,prices", ["prices", "x402"]],
    ["x402", ["x402"]],
  ] as const)("reads %j as %j", (setting, products) =>
    expect(enabledProducts(setting)).toEqual(products),
  );

  it("ignores names it doesn't know", () => {
    expect(enabledProducts("prices,soroban,X402")).toEqual(["prices"]);
    expect(enabledProducts("soroban")).toEqual([]);
  });
});
