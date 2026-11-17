import { ANCHORS, EXPLORER_URL } from "../links";

const POINTS = [
  "Skip running and maintaining your own Soroban indexer",
  "Decoded contract calls and events, not raw XDR",
  "Mainnet and testnet from one API",
  "[ACCESS MODEL: API key, x402 pay-per-call, or both]",
];

/** A key of the preview's JSON, in the accent. */
const key = (name: string) => <span className="preview-key">{`"${name}"`}</span>;

/**
 * The design's terminal: a call to the API that isn't out yet and its answer. The `<pre>` scrolls
 * sideways inside itself on a phone, so it takes the keyboard's focus, to be scrolled by keys too,
 * and is a region named by its bar's label, which is what a screen reader says on landing there.
 */
function Preview() {
  return (
    <div className="preview">
      <div className="preview-bar">
        <span id="ssa-preview-name" className="preview-name">
          soroban-scan-api
        </span>
        <span className="preview-note">Preview · subject to change</span>
      </div>
      <pre tabIndex={0} role="region" aria-labelledby="ssa-preview-name">
        <span className="preview-prompt">$</span>
        {" curl api.sorobanscan.com/scan/contracts/C…/events\n\n"}
        <span className="preview-ok"># 200 OK</span>
        {"\n{\n  "}
        {key("contract")}
        {': "C…TOKEN",\n  '}
        {key("events")}
        {": [\n    {\n      "}
        {key("topic")}
        {': ["transfer", "G…FROM", "G…TO"],\n      '}
        {key("value")}
        {': "1000000",\n      '}
        {key("ledger")}
        {": [LEDGER],\n      "}
        {key("tx")}
        {': "[TX_HASH]"\n    }\n  ]\n}'}
      </pre>
    </div>
  );
}

/**
 * The third product, not out yet. Its head has a pill beside the eyebrow, which `SectionHead`
 * doesn't, so the head is written here with the same classes.
 */
export function SorobanScanApi() {
  return (
    <section id={ANCHORS.sorobanScanApi} aria-labelledby="ssa-title" className="wrap section ssa">
      <div className="ssa-copy">
        <div className="section-head ssa-head">
          <div className="ssa-tag">
            <p className="eyebrow">Soroban Scan API</p>
            <span className="pill pill-lg pill-soon">COMING SOON</span>
          </div>
          <h2 id="ssa-title">The explorer’s index, as an API</h2>
          <p className="section-lead">
            Soroban Scan already indexes every contract, invocation and event on Stellar. Next, we
            are opening that index to developers and agents.
          </p>
        </div>
        <ul className="ssa-points">
          {POINTS.map((point) => (
            <li key={point}>
              <span aria-hidden="true">→</span>
              {point}
            </li>
          ))}
        </ul>
        <div className="btn-row">
          <a className="btn btn-primary" href={EXPLORER_URL}>
            Open the explorer
          </a>
        </div>
      </div>
      <Preview />
    </section>
  );
}
