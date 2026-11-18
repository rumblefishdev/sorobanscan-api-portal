import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PrivacyPolicy, { POLICY } from './PrivacyPolicy';
import policyMd from './privacy-policy.md?raw';
import rendered from './privacy-policy.rendered.txt?raw';

/**
 * The text is the reviewed document and the page is a reading of it, so the
 * two properties worth holding are that nothing of the document is lost and
 * nothing of Markdown's notation leaks onto the page.
 */
describe('the privacy policy text', () => {
  it('reads as sixteen numbered sections in order, with the notation gone', () => {
    expect(POLICY.title).toBe(
      'Privacy Policy – Prices API for the Stellar ecosystem',
    );
    expect(POLICY.intro).toHaveLength(2);
    expect(POLICY.sections.map((s) => s.number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    expect(new Set(POLICY.sections.map((s) => s.id)).size).toBe(16);
    expect(POLICY.sections.every((s) => s.blocks[0]?.kind === 'p')).toBe(true);
    const text = JSON.stringify(POLICY);
    // `1\.` and `\+48` are unescaped, headings lose their `**`, no `#` leaks.
    expect(text).not.toMatch(/\\\\[.+]/);
    expect(text).not.toContain('**1.');
    expect(text).not.toContain('# ');
  });

  it('keeps every bullet and sub-heading of the document', () => {
    // Literal counts from the delivered draft, not derived from the file:
    // a count read off the same file passed while Prettier had rewritten
    // every `*` into a `-` the reader did not know, and the page showed
    // 79 paragraphs beginning with "- ". These change only when the text
    // does, which is when somebody should look.
    const blocks = POLICY.sections.flatMap((s) => s.blocks);
    const bullets = blocks.reduce(
      (n, b) => n + (b.kind === 'ul' ? b.items.length : 0),
      0,
    );
    expect(bullets).toBe(79);
    expect(blocks.filter((b) => b.kind === 'h3')).toHaveLength(3);
    // And no list marker survives as text.
    const texts = blocks.flatMap((b) => (b.kind === 'ul' ? b.items : [b.text]));
    expect(texts.filter((t) => /^[-*] /.test(t))).toEqual([]);
    expect(policyMd.length).toBeGreaterThan(10_000);
  });
});

describe('the privacy policy page', () => {
  it('renders each section as a heading with a rail entry, and the inline marks as markup', () => {
    render(<PrivacyPolicy />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      POLICY.title,
    );
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(16);
    const rail = within(
      screen.getByRole('navigation', { name: 'On this page' }),
    );
    expect(rail.getAllByRole('link')).toHaveLength(16);
    // `**Rumble Fish Poland …**` and `` `identify` `` in the document.
    expect(
      screen.getAllByText(
        'Rumble Fish Poland Spółka z ograniczoną odpowiedzialnością',
      )[0].tagName,
    ).toBe('STRONG');
    expect(screen.getByText('identify').tagName).toBe('CODE');
    // The date the page carries for the text.
    expect(screen.getByText(/version of 29 september 2026/i)).toBeTruthy();
  });
});

describe('the privacy policy page and x402', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is exactly the reviewed document, as it was, while x402 is off', () => {
    // `privacy-policy.rendered.txt` is the page's text as it was drawn before x402's
    // section existed; the default build and a build naming Prices alone must match it.
    for (const setting of [undefined, '', 'prices']) {
      vi.stubEnv('VITE_PRODUCTS', setting as string);
      const { container, unmount } = render(<PrivacyPolicy />);
      expect(container.textContent).toBe(rendered);
      expect(screen.queryByText(/x402 Facilitator API keys/)).toBeNull();
      unmount();
    }
  });

  it('adds x402 Facilitator API keys after the last section, in the rail too, when x402 is on', () => {
    vi.stubEnv('VITE_PRODUCTS', 'prices,x402');
    render(<PrivacyPolicy />);

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(17);
    expect(headings[16].textContent).toBe('17. x402 Facilitator API keys');
    const rail = within(
      screen.getByRole('navigation', { name: 'On this page' }),
    );
    const links = rail.getAllByRole('link');
    expect(links).toHaveLength(17);
    expect(links[16].textContent).toBe('x402 Facilitator API keys');
    // The reviewed sections stay as they were, and the file's first-line comment is not drawn.
    expect(headings[0].textContent).toBe('1. Controller of Your Personal Data');
    expect(document.body.textContent).not.toContain('<!--');
    expect(document.body.textContent).not.toMatch(/counsel/);
    expect(document.body.textContent).toMatch(/SHA-256/);
  });
});
