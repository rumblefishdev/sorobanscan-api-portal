import { Fragment } from "react";
import { SectionHead } from "../components/SectionHead";
import { ANCHORS } from "../links";

/** The flow under the head: the products in the order of the steps below, then your app. */
const FLOW = [
  { name: "Prices API", kind: "live" },
  { name: "x402 Facilitator", kind: "live" },
  { name: "Soroban Scan API", kind: "soon" },
  { name: "Your app", kind: "app" },
] as const;

/** The three numbered steps: what each product does in that flow. */
const STEPS = [
  {
    label: "01 · Read",
    title: "Know what a token is worth",
    text: "Prices API gives your app or agent a live price before it quotes, swaps or pays.",
  },
  {
    label: "02 · Pay & get found",
    title: "Get paid, get discovered",
    text: "The x402 Facilitator settles each call in about five seconds, fees sponsored. Every sale also ranks your API higher in the Bazaar.",
  },
  {
    label: "03 · Verify",
    title: "See it on chain",
    text: "Every settlement links to Soroban Scan today. Soon you can query it programmatically.",
  },
];

export function HowTheyConnect() {
  return (
    <section id={ANCHORS.stack} aria-labelledby="stack-title" className="wrap section">
      <SectionHead
        titleId="stack-title"
        eyebrow="How they connect"
        title="Read. Pay. Verify."
        lead="Each API stands on its own, and they are designed to work together on one network."
      />
      <div role="list" aria-label="Product flow" className="flow">
        {FLOW.map(({ name, kind }, i) => (
          <Fragment key={name}>
            {i === 0 ? null : (
              <span aria-hidden="true" className="flow-arrow">
                →
              </span>
            )}
            <span
              role="listitem"
              className={kind === "live" ? "flow-item" : `flow-item flow-${kind}`}
            >
              {name}
            </span>
          </Fragment>
        ))}
      </div>
      <ol className="steps">
        {STEPS.map(({ label, title, text }) => (
          <li key={label} className="step">
            <span className="step-label">{label}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
