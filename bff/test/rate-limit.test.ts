import { describe, expect, it } from "vitest";
import { rateLimiter } from "../src/rate-limit";

describe("rateLimiter", () => {
  it("allows the 30th hit in a window and refuses the 31st, saying when to retry", () => {
    let t = 1_000_000;
    const limiter = rateLimiter(30, 60_000, () => t);
    for (let i = 0; i < 30; i++) expect(limiter.hit("a").allowed).toBe(true);
    t += 5_000;
    const over = limiter.hit("a");
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(over.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("allows the key again a window later", () => {
    let t = 0;
    const limiter = rateLimiter(30, 60_000, () => t);
    for (let i = 0; i < 31; i++) limiter.hit("a");
    t += 60_000;
    expect(limiter.hit("a").allowed).toBe(true);
  });

  it("never lets one key's hits count against another", () => {
    const limiter = rateLimiter(30, 60_000, () => 0);
    for (let i = 0; i < 100; i++) limiter.hit("a");
    expect(limiter.hit("b").allowed).toBe(true);
  });
});
