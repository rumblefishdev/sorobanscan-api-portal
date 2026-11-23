import { ANCHORS, PRICES_API_URL, X402_URL } from "../links";

/**
 * The closing panel. It has no eyebrow and is centred, so its `<h2>` is written here rather than
 * through `SectionHead`.
 */
export function Closing() {
  return (
    <section aria-labelledby="cta-title" className="wrap section closing">
      <div className="closing-panel">
        <h2 id="cta-title">Build on Stellar with fewer moving parts</h2>
        <p className="section-lead">
          Prices, payments and agent discovery are live today. Chain data is next.
        </p>
        <div className="btn-row">
          <a className="btn btn-primary" href={PRICES_API_URL}>
            Prices API
          </a>
          <a className="btn btn-primary" href={X402_URL}>
            x402 Facilitator
          </a>
          <a className="btn btn-ghost" href={`#${ANCHORS.sorobanScanApi}`}>
            Soroban Scan API · soon
          </a>
        </div>
      </div>
    </section>
  );
}
