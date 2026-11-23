import { SectionHead } from "../components/SectionHead";
import { ANCHORS } from "../links";

/** The design's questions and answers; the first is open, as the design shows it. */
const QUESTIONS = [
  {
    question: "Do I need a separate key for each API?",
    answer:
      "Yes. Each API has its own key, so you can manage access, limits and usage per product. Each product page explains how to get yours.",
  },
  {
    question: "Can I use the APIs together?",
    answer:
      "Yes. They run on the same network and the same infrastructure. A common setup reads a price, sells a call through x402, gets listed in the Bazaar and checks the payment in Soroban Scan.",
  },
  {
    question: "Mainnet or testnet?",
    answer:
      "The x402 Facilitator runs on testnet today, where it is free, and on mainnet soon. Network coverage for the other APIs is listed on each product page.",
  },
  {
    question: "Can AI agents use these APIs?",
    answer:
      "Yes. Agents browse the x402 Bazaar through /discovery/resources and pay per request without accounts. No key is needed to browse. Plain-language search, through /discovery/search or our MCP server, and ranking by successful purchases are coming soon.",
  },
];

/** One `<details>` per question, the question its `<summary>` with the design's `+` beside it. */
export function Faq() {
  return (
    <section id={ANCHORS.faq} aria-labelledby="faq-title" className="wrap section faq">
      <SectionHead titleId="faq-title" eyebrow="FAQ" title="Common questions" />
      <div className="faq-list">
        {QUESTIONS.map(({ question, answer }, i) => (
          <details key={question} open={i === 0}>
            <summary>
              {question}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
