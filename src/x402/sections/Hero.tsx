import { useState } from "react";
import { DocsLink, GetKeyLink } from "../components/SectionHead";
import { Soon } from "../components/Soon";

const EXAMPLES = ["Token prices", "Weather forecast", "Web search"];

/**
 * The search box. It only holds the words: the facilitator has no search route to send them to
 * yet (`/discovery/search` answers 404), so the card is marked Soon and says where the listings
 * are today.
 */
function BazaarSearch() {
  const [query, setQuery] = useState("");
  return (
    <div className="card search">
      <div className="search-head">
        <h2>
          Search our Bazaar <Soon />
        </h2>
        <p>
          Describe what you need in plain words. Results will be ranked by the volume of successful
          purchases.
        </p>
      </div>
      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="sr-only" htmlFor="bazaar-q">
          Search the Bazaar
        </label>
        <input
          id="bazaar-q"
          type="search"
          placeholder="e.g. hourly weather forecast"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>
      <div className="chips">
        <span>Try:</span>
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="chip" onClick={() => setQuery(example)}>
            {example}
          </button>
        ))}
      </div>
      <p className="search-foot">
        Plain-language search through <code>/discovery/search</code> and our MCP server is coming.
        Today agents browse every listing at <code>/discovery/resources</code>, no key needed.
      </p>
    </div>
  );
}

export function Hero() {
  return (
    <div className="first-screen">
      <section aria-labelledby="hero-title" className="wrap hero">
        <div className="col hero-copy">
          <p className="status">Live on Stellar Testnet · Mainnet soon</p>
          <h1 id="hero-title">Get your API found by AI agents</h1>
          <p className="hero-lead">
            The x402 facilitator for Stellar with a built-in Bazaar. Every API paid through us is
            listed, so AI agents can discover your services autonomously and pay for them. Ranking
            by the volume of successful purchases and search in plain language are coming soon.
          </p>
          <p className="hero-sub">
            Plus everything a facilitator should do: verify, settle, sponsored fees, any SEP-41
            token. Open source, Apache-2.0.
          </p>
          <div className="btn-row">
            <GetKeyLink />
            <DocsLink />
          </div>
        </div>
        <BazaarSearch />
      </section>

      <section aria-label="Highlights" className="highlights">
        <div className="wrap">
          <span className="note">
            Built by <strong>Rumble Fish</strong>
          </span>
          <span>Open source, Apache-2.0</span>
          <span>Non-custodial</span>
          <span>x402 v2</span>
          <span>Stellar ecosystem</span>
        </div>
      </section>
    </div>
  );
}
