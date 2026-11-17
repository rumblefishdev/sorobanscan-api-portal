import type { ReactNode } from "react";
import { SectionHead } from "../components/SectionHead";

/** What the team stands for, as the design's three cards, each under its 28px line icon. */
const CARDS: readonly { title: string; text: string; icon: ReactNode }[] = [
  {
    title: "Soroban-native",
    text: "Built for Soroban contracts and auth entries from day one, not ported from another chain.",
    icon: (
      <>
        <path d="M4 7l8-4 8 4-8 4z" />
        <path d="M4 12l8 4 8-4" />
        <path d="M4 17l8 4 8-4" />
      </>
    ),
  },
  {
    title: "Funded by the community",
    text: "The x402 Facilitator is backed by a Stellar Community Fund grant and maintained beyond it.",
    icon: (
      <>
        <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    title: "Open where it counts",
    text: "The facilitator is Apache-2.0 on GitHub. Use our hosted endpoints or run your own.",
    icon: (
      <>
        <path d="M8 8l-5 4 5 4" />
        <path d="M16 8l5 4-5 4" />
        <path d="M14 4l-4 16" />
      </>
    ),
  },
];

export function BuiltBy() {
  return (
    <section aria-labelledby="built-title" className="wrap section">
      <SectionHead
        titleId="built-title"
        eyebrow="Built by Rumble Fish"
        title="Infrastructure from the Soroban Scan team"
        lead="We build public Stellar tooling that developers rely on every day, and keep maintaining it after launch."
      />
      <div className="built">
        {CARDS.map(({ title, text, icon }) => (
          <article key={title} className="built-card">
            <svg
              aria-hidden="true"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {icon}
            </svg>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
