import {
  envelopeOf,
  FakeProduct,
  later,
  type Answer,
  type Answering,
  type Claims,
  type ProductCall,
  type ProductRoute,
} from "./fake-product.ts";

export { later, type Answer, type Answering, type Claims };
export type PricesCall = ProductCall;
export type PricesRoute = ProductRoute;

/** Prices' hub contract as the tests' settings name it. */
export const PRICES_API = "https://prices-api.test/api/hub/v1";
/** The secret the fake checks tokens with, as Prices reads the shared one: the hub's must match. */
export const PRICES_SECRET = Buffer.alloc(32, 0x42);
/** The key the fake reveals: no log or error of the hub's may hold it. */
export const KEY_VALUE = "pk_the-revealed-key-value-0123456789";

/** An answer in Prices' error envelope. */
export const envelope = envelopeOf("Prices");

/** Prices' hub contract in memory: {@link FakeProduct} for `prices`. */
export class FakePrices extends FakeProduct {
  constructor(now: () => number, secret: Buffer = PRICES_SECRET) {
    super(now, {
      product: "prices",
      label: "Prices",
      api: PRICES_API,
      secret,
      usual: (route, discordId) => FakePrices.usual(route, discordId),
    });
  }

  /** The usual answer to `route` for `claims`' account. */
  static usual(route: PricesRoute, discordId: string): Record<string, unknown> {
    switch (route) {
      case "/account":
        return {
          key: {
            state: "active",
            key_id: "k-0001",
            created_at: "2026-11-01T10:00:00Z",
            last_updated_at: "2026-11-01T10:00:00Z",
            can_issue: false,
          },
          details: {
            usage: { used: 120, remaining: 880, limit: 1000, period: "month" },
            free_rate_limit_per_second: 5,
          },
        };
      case "/key/reveal":
        return {
          key_id: "k-0001",
          name: `discord-${discordId}-key`,
          value: KEY_VALUE,
          created_at: "2026-11-01T10:00:00Z",
          last_updated_at: "2026-11-01T10:00:00Z",
        };
      case "/key/revoke":
        return {
          revoked: true,
          next_eligible_at: "2026-12-01T00:00:00Z",
          revoked_at: "2026-11-17T12:00:00Z",
        };
      case "/key/issue":
        return { outcome: "issued" };
    }
  }

}
