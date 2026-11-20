import { describe, expect, it } from "vitest";
import { clientKey } from "../src/client-address";

describe("clientKey", () => {
  it("keys an IPv4 address by itself", () => {
    expect(clientKey("198.51.100.10")).toBe("198.51.100.10");
  });

  it("counts one /56 as one client", () => {
    expect(clientKey("2001:db8:abcd:12ff:1::1")).toBe(clientKey("2001:db8:abcd:1200:ffff::2"));
  });

  it("tells two /56s apart", () => {
    expect(clientKey("2001:db8:abcd:1300::1")).not.toBe(clientKey("2001:db8:abcd:12ff::1"));
  });

  it("counts anything but a bare address as one client, 'unknown'", () => {
    for (const odd of [
      undefined,
      "",
      "garbage",
      "198.51.100.10:46532",
      "1.2.3.4, 5.6.7.8",
      "[::1]",
      " 198.51.100.10",
    ]) {
      expect(clientKey(odd)).toBe("unknown");
    }
  });
});
