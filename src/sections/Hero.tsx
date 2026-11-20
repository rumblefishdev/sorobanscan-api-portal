import { ANCHORS, PRICES_API_URL, X402_QUICK_START_URL } from "../links";

/** The rows of the hero's `ls /api`: each product, where it lives, and whether it is out yet. */
const DIRECTORY = [
  {
    path: "prices-api/",
    href: PRICES_API_URL,
    about: "Token prices, live and historical",
    live: true,
  },
  {
    path: "x402-facilitator/",
    href: X402_QUICK_START_URL,
    about: "Get paid and found by AI agents",
    live: true,
  },
  {
    path: "sorobanscan-api/",
    href: `#${ANCHORS.sorobanScanApi}`,
    about: "Contracts, transactions, events",
    live: false,
  },
];

/** The products as a terminal listing of `sorobanscan.com/api`, each row a link to its page. */
function Directory() {
  return (
    <nav aria-label="API directory" className="directory">
      <div className="directory-bar">
        <span aria-hidden="true" className="directory-dot" />
        <span aria-hidden="true" className="directory-dot" />
        <span aria-hidden="true" className="directory-dot" />
        <span className="directory-host">sorobanscan.com/api</span>
      </div>
      <div className="directory-prompt">
        <span>$</span> <span className="directory-command">ls /api</span>
      </div>
      <ul>
        {DIRECTORY.map(({ path, href, about, live }) => (
          <li key={path}>
            <a className={live ? undefined : "soon"} href={href}>
              <code>{path}</code> <span className="directory-about">{about}</span>{" "}
              <span className={live ? "pill pill-live" : "pill pill-soon"}>
                {live ? "Live" : "Coming soon"}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The first screen: the hero and the strip under it, in one block that the stylesheet sizes to the
 * viewport below the top bar, as the Prices portal does, so the strip sits at the bottom of the
 * screen rather than being cut by it. The block is a plain `div`: the two sections stay as they are.
 */
export function Hero() {
  return (
    <div className="first-screen">
      <section aria-labelledby="hero-title" className="wrap hero">
        <div className="hero-copy">
          <p className="status">2 APIs live · 1 coming soon</p>
          <h1 id="hero-title">Stellar data and payments, as APIs</h1>
          <p className="hero-lead">
            Token prices, x402 payments with a Bazaar that AI agents search and, soon, the full
            Soroban Scan index. Three APIs from the team behind Soroban Scan, built for developers
            and agents on Stellar.
          </p>
          <div className="btn-row">
            <a className="btn btn-primary" href={`#${ANCHORS.products}`}>
              Browse APIs
            </a>
            <a className="btn btn-ghost" href={`#${ANCHORS.choose}`}>
              Which one do I need?
            </a>
          </div>
        </div>
        <Directory />
      </section>

      <section aria-label="Highlights" className="highlights">
        <div className="wrap">
          <span className="built-by">
            Built by <strong>Rumble Fish</strong>
          </span>
          <span>Stellar mainnet and testnet</span>
          <span>Soroban-native</span>
          <span>Agent-ready</span>
          <span>Backed by the Stellar Community Fund</span>
        </div>
      </section>
    </div>
  );
}
