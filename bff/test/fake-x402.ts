import type { ProductRoute } from "./fake-product.ts";

/** The key value x402's fake reveals. */
export const X402_KEY = "x402_the-revealed-key-value-0123456789";

/** The account's payments on Mainnet this month, as x402's `account` has them (`details.usage`). */
export const X402_USAGE = {
  used: 312,
  remaining: 688,
  limit: 1000,
  period_start: "2026-11-01T00:00:00Z",
  period_end: "2026-12-01T00:00:00Z",
  resets_at: "2026-12-01T00:00:00Z",
  as_of: "2026-11-18T12:00:00Z",
  plan: { name: "free", quota_limit: 1000, quota_period: "month" },
};

/** x402's usual answers, in the shapes of its hub contract (not Prices'). */
export function x402Usual(route: ProductRoute, _discordId: string): Record<string, unknown> {
  switch (route) {
    case "/account":
      return {
        key: {
          state: "active",
          key_id: "0123456789ab",
          created_at: "2026-11-18T10:00:00Z",
          can_issue: false,
        },
        details: { showable: true, usage: X402_USAGE },
      };
    case "/key/reveal":
      return { key_id: "0123456789ab", value: X402_KEY, created_at: "2026-11-18T10:00:00Z" };
    case "/key/revoke":
      return {
        revoked: true,
        revoked_at: "2026-11-18T11:00:00Z",
        next_eligible_at: "2026-12-01T00:00:00Z",
      };
    case "/key/issue":
      return { outcome: "issued" };
  }
}
