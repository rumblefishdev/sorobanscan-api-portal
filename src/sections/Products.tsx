import type { ReactNode } from "react";
import { SectionHead } from "../components/SectionHead";
import { ANCHORS, GITHUB_URL, PRICES_API_URL, X402_URL } from "../links";

/** One of the design's line icons, drawn at 32px in the accent (the colour is the CSS's). */
function LineIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="product-icon"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

type Product = {
  name: string;
  category: string;
  icon: ReactNode;
  live: boolean;
  about: string;
  points: readonly string[];
  endpoint: string;
  /** The card's buttons: the product's own page first, in the accent ("soon" outlined in it). */
  links: readonly { label: string; href: string; kind: "primary" | "ghost" | "soon" }[];
};

/** The three products, as the design's cards have them. */
const PRODUCTS: readonly Product[] = [
  {
    name: "Prices API",
    category: "Market data",
    icon: (
      <LineIcon>
        <path d="M3 3v18h18" />
        <path d="M7 15l4-4 3 3 6-7" />
      </LineIcon>
    ),
    live: true,
    about:
      "Real-time and historical token prices on Stellar, aggregated across SDEX and four Soroban AMMs.",
    points: [
      "Live prices for classic assets and Soroban tokens",
      "Price history for charts, backtests and reports",
      "SDEX plus four Soroban AMMs in one feed",
      "Self-service API key",
    ],
    endpoint: "api.sorobanscan.com/prices",
    links: [{ label: "Explore Prices API", href: PRICES_API_URL, kind: "primary" }],
  },
  {
    name: "x402 Facilitator",
    category: "Payments + discovery",
    icon: (
      <span aria-hidden="true" className="product-mark">
        402
      </span>
    ),
    live: true,
    about:
      "Get your API found by AI agents. Charge per request on Stellar, and every sale lists your API in our Bazaar, where agents search for what to buy.",
    points: [
      "Bazaar: listed on your first sale",
      "Ranked by volume of successful purchases",
      "Plain-language search and MCP server for agents",
      "Verify, settle, sponsored fees, any SEP-41 token",
    ],
    endpoint: "api.sorobanscan.com/x402",
    links: [
      { label: "Explore x402 Facilitator", href: X402_URL, kind: "primary" },
      { label: "GitHub", href: GITHUB_URL, kind: "ghost" },
    ],
  },
  {
    name: "Soroban Scan API",
    category: "Chain data",
    icon: (
      <LineIcon>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
        <path d="M8 11h6" />
        <path d="M11 8v6" />
      </LineIcon>
    ),
    live: false,
    about:
      "The index behind the Soroban Scan explorer, as an API. Query contracts, transactions and events without running your own indexer.",
    points: [
      "Contracts, code and metadata",
      "Transactions and contract invocations",
      "Contract events, filterable by topic",
      "Same data you see in the explorer",
    ],
    endpoint: "api.sorobanscan.com/scan",
    links: [{ label: "See what’s coming", href: `#${ANCHORS.sorobanScanApi}`, kind: "soon" }],
  },
];

function ProductCard({ product }: { product: Product }) {
  const { name, category, icon, live, about, points, endpoint, links } = product;
  return (
    <article className={live ? "product" : "product soon"}>
      <div className="product-top">
        {icon}
        <span className={live ? "pill pill-lg pill-live" : "pill pill-lg pill-filled"}>
          {live ? "Live" : "COMING SOON"}
        </span>
      </div>
      <div className="product-intro">
        <span className="product-category">{category}</span>
        <h3>{name}</h3>
        <p>{about}</p>
      </div>
      <ul className="product-points">
        {points.map((point) => (
          <li key={point}>
            <span aria-hidden="true">→</span>
            {point}
          </li>
        ))}
      </ul>
      <div className="product-end">
        <code>{endpoint}</code>
        <div className="product-links">
          {links.map(({ label, href, kind }) => (
            <a key={label} className={`btn btn-${kind}`} href={href}>
              {label}
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}

export function Products() {
  return (
    <section id={ANCHORS.products} aria-labelledby="products-title" className="wrap section">
      <SectionHead
        titleId="products-title"
        eyebrow="Products"
        title="Three APIs. One Stellar stack."
        lead="Each product has its own page, docs and keys. Pick the one you need, or use them together."
      />
      <div className="products">
        {PRODUCTS.map((product) => (
          <ProductCard key={product.name} product={product} />
        ))}
      </div>
    </section>
  );
}
