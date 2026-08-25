import { describe, expect, it } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { App } from './App.js';

const NAV_LABELS = ['Capture', 'Timeline', 'Assets', 'Contributors', 'Provenance', 'Documents', 'Delivery'] as const;

/**
 * Global audit: across every view, no rendered text may claim ownership,
 * verified creative credit, or verified contribution. This complements
 * the more specific assertions in App.test.tsx with a broad sweep.
 */
const BANNED_PATTERNS: readonly RegExp[] = [
  /\bverified contributor\b/i,
  /\bverified credit\b/i,
  /\bverified creative contribution\b/i,
  /\bverified creative credit\b/i,
  /\bverified authorship\b/i,
  /\bownership determination\b/i,
  /\bcopyright owner\b/i,
  /\brights holder\b/i,
  /\bofficial credit\b/i,
  /\bcreator:\s/i,
];

describe('trust language audit', () => {
  for (const label of NAV_LABELS) {
    it(`"${label}" view never uses banned verification/ownership language`, () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: label }));
      const bodyText = document.body.textContent ?? '';

      for (const pattern of BANNED_PATTERNS) {
        expect(bodyText).not.toMatch(pattern);
      }
    });
  }

  it('the word "Creator" never appears as a standalone field label', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    const firstCard = document.querySelector('.asset-card');
    if (firstCard !== null) {
      fireEvent.click(firstCard);
    }
    // "Creator" (capital-C, as a label) must not appear; lowercase "creative"
    // legitimately appears throughout (e.g. "creative artifact") and is not matched.
    expect(document.body.textContent).not.toMatch(/\bCreator\b/);
  });

  it('contributor claims never say "Confirmed" or "Supported" either', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Contributors' }));
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toMatch(/\bConfirmed\b/);
    expect(bodyText).not.toMatch(/\bSupported\b/);
  });
});
