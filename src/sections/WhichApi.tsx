import { SectionHead } from "../components/SectionHead";
import { ANCHORS, PRICES_API_URL, X402_QUICK_START_URL } from "../links";

/** "Which API?": what someone is building, and the product it leads to. */
const USE_CASES = [
  {
    need: "I need token prices for a wallet, dashboard or trading bot",
    product: "Prices API",
    href: PRICES_API_URL,
    live: true,
  },
  {
    need: "I want price history for charts, analytics or accounting",
    product: "Prices API",
    href: PRICES_API_URL,
    live: true,
  },
  {
    need: "I want AI agents to find my API and pay for it on their own",
    product: "x402 Facilitator",
    href: X402_QUICK_START_URL,
    live: true,
  },
  {
    need: "My AI agent needs to find paid tools and data, and pay for them",
    product: "x402 Facilitator",
    href: X402_QUICK_START_URL,
    live: true,
  },
  {
    need: "I need contract, transaction or event data without running an indexer",
    product: "Soroban Scan API",
    href: `#${ANCHORS.sorobanScanApi}`,
    live: false,
  },
];

export function WhichApi() {
  return (
    <section id={ANCHORS.choose} aria-labelledby="choose-title" className="wrap section">
      <SectionHead
        titleId="choose-title"
        eyebrow="Which API?"
        title="Start from what you are building"
        lead="Find your use case, follow the arrow."
      />
      <ul className="use-cases">
        {USE_CASES.map(({ need, product, href, live }) => (
          <li key={need}>
            <a className={live ? undefined : "soon"} href={href}>
              <span className="use-case-need">{need}</span>{" "}
              <span className="use-case-product">
                {product}{" "}
                {live ? (
                  <span aria-hidden="true">→</span>
                ) : (
                  <span className="pill pill-soon">Coming soon</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
