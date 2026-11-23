import { EXPLORER_URL, GITHUB_URL, HUB_URL, PRICES_API_URL } from "../../links";
import { LogInLink } from "../components/SectionHead";

export function Header() {
  return (
    <header className="site-header">
      <nav aria-label="Main" className="wrap">
        <a className="brand" href="#top">
          <span aria-hidden="true" className="brand-mark">
            402
          </span>
          <span className="brand-name">x402 Facilitator</span>
          <span className="brand-by">by Rumble Fish</span>
        </a>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#quickstart">Quickstart</a>
          <a href="#endpoints">Endpoints</a>
          <a href="#faq">FAQ</a>
          <a href={GITHUB_URL}>GitHub</a>
          <LogInLink />
        </div>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span>x402 Facilitator by Rumble Fish · Apache-2.0</span>
        <nav aria-label="Footer">
          <a href={EXPLORER_URL}>Soroban Scan</a>
          <a href={PRICES_API_URL}>Prices API</a>
          <a href={HUB_URL}>All APIs</a>
          <a href={GITHUB_URL}>GitHub</a>
          <a href="#top">Status</a>
        </nav>
      </div>
    </footer>
  );
}
