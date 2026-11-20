import { describe, expect, it } from "vitest";
import { clientKey } from "../src/client-address";

describe("clientKey", () => {
  it("takes the port off an IPv4 address", () => {
    expect(clientKey("198.51.100.10:46532")).toBe("198.51.100.10");
  });

  it("counts one /56 as one client, in either form an IPv6 address and a port may come in", () => {
    expect(clientKey("[2001:db8:abcd:12ff:1::1]:443")).toBe(
      clientKey("2001:db8:abcd:1200:ffff::2:8080"),
    );
  });

  it("tells two /56s apart", () => {
    expect(clientKey("[2001:db8:abcd:1300::1]:443")).not.toBe(
      clientKey("[2001:db8:abcd:12ff::1]:443"),
    );
  });

  it("counts anything it can't read as one client, 'unknown'", () => {
    for (const odd of [undefined, "", "garbage", "198.51.100.10", "1.2.3.4:1, 5.6.7.8:2", "[::1"]) {
      expect(clientKey(odd)).toBe("unknown");
    }
  });
});
