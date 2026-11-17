import {
  ANCHORS, DASHBOARD_URL, EXPLORER_URL, GITHUB_URL, LOGIN_URL, PRICES_API_URL, X402_URL,
} from "../links";
import { useSignedIn } from "../session";

export function TopBar() {
  // "Log in" while the backend is asked too, the common case. One link either way, the same
  // button, so the bar doesn't move when it turns into "Dashboard".
  const signedIn = useSignedIn();
  return (
    <header className="site-header">
      <nav aria-label="Main" className="wrap">
        <a className="brand" href={`#${ANCHORS.top}`}>
          <span aria-hidden="true" className="brand-mark">
            /api
          </span>
          <span className="brand-name">Soroban Scan APIs</span>{" "}
          <span className="brand-by">by Rumble Fish</span>
        </a>
        <div className="nav-links">
          <a href={`#${ANCHORS.products}`}>Products</a>
          <a href={`#${ANCHORS.choose}`}>Which API?</a>
          <a href={`#${ANCHORS.stack}`}>How they connect</a>
          <a href={`#${ANCHORS.faq}`}>FAQ</a>
          <a href={EXPLORER_URL}>Explorer</a>
          <a className="btn btn-primary" href={signedIn ? DASHBOARD_URL : LOGIN_URL}>
            {signedIn ? "Dashboard" : "Log in"}
          </a>
        </div>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span>Soroban Scan APIs by Rumble Fish</span>
        <nav aria-label="Footer">
          <a href={EXPLORER_URL}>Soroban Scan</a>
          <a href={PRICES_API_URL}>Prices API</a>
          <a href={X402_URL}>x402 Facilitator</a>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
