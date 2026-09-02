import { describe, expect, it } from 'vitest';

import { isValidTag } from './isValidTag.ts';

const options = { minLength: 2, maxLength: 128 };

describe('isValidTag', () => {
  it('accepts ordinary tag names', () => {
    expect(isValidTag('Acid Jazz', options)).toBe(true);
    expect(isValidTag('Rock en Español', options)).toBe(true);
    expect(isValidTag('Adult Contemporary R&B', options)).toBe(true);
  });

  it('accepts short tags that happen to look like abbreviations', () => {
    expect(isValidTag('R.E.M.', options)).toBe(true);
    expect(isValidTag('U2', options)).toBe(true);
    expect(isValidTag('Y2K', options)).toBe(true);
    expect(isValidTag('Lo-fi', options)).toBe(true);
    expect(isValidTag('80s', options)).toBe(true);
  });

  it('rejects tags shorter than minLength', () => {
    expect(isValidTag('_', options)).toBe(false);
    expect(isValidTag('A', options)).toBe(false);
  });

  it('rejects tags longer than maxLength', () => {
    expect(isValidTag('a'.repeat(129), options)).toBe(false);
    expect(isValidTag('a'.repeat(128), options)).toBe(true);
  });

  it('rejects domain/URL-like tags', () => {
    expect(isValidTag('www.TopMusic.rs', options)).toBe(false);
    expect(isValidTag('?CNHiFi.COM', options)).toBe(false);
    expect(isValidTag('©CNHiFi.COM', options)).toBe(false);
    expect(isValidTag('StraightFresh.net', options)).toBe(false);
    expect(isValidTag('sbsp.rocks.it', options)).toBe(false);
  });

  it('rejects tags with no Latin letters or digits (non-Latin scripts)', () => {
    expect(isValidTag('Поп', options)).toBe(false);
    expect(isValidTag('宝塚', options)).toBe(false);
    expect(isValidTag('アジア', options)).toBe(false);
    expect(isValidTag('일렉트로니카', options)).toBe(false);
  });

  it('rejects non-Latin tags even when combined with punctuation that slugifyTagName treats specially', () => {
    // slugifyTagName replaces "&" with the word "and", which would otherwise make this slugify to a
    // non-empty string despite having no real Latin content of its own.
    expect(isValidTag('Фильмы & Игры', options)).toBe(false);
  });

  it('accepts tags with accents/diacritics, since they contain real Latin content', () => {
    expect(isValidTag('Électronique', options)).toBe(true);
    expect(isValidTag('Yé-yé', options)).toBe(true);
  });

  it('accepts mixed-script tags that still contain real Latin content', () => {
    expect(isValidTag('Classical • Post Modern  &  Electronic', options)).toBe(true);
  });

  it('rejects tags that are purely numeric', () => {
    expect(isValidTag('13', options)).toBe(false);
    expect(isValidTag('1980', options)).toBe(false);
  });

  it('accepts tags that mix numbers with real content', () => {
    expect(isValidTag('Y2K', options)).toBe(true);
    expect(isValidTag('80s', options)).toBe(true);
  });

  it('strips bracket characters before validating the text they contain', () => {
    // "(255)" is invalid because "255" is purely numeric, not because it's bracketed
    expect(isValidTag('(255)', options)).toBe(false);
    // "[Untitled]" is valid because "Untitled" is a normal word once the brackets are removed - there's
    // no algorithmic way to tell a placeholder word like this apart from a real tag name
    expect(isValidTag('[Untitled]', options)).toBe(true);
    expect(isValidTag('<Unknown>', options)).toBe(true);
  });

  it('accepts tags that merely contain brackets rather than being fully wrapped', () => {
    expect(isValidTag('Ambient (Chill)', options)).toBe(true);
    expect(isValidTag('R.E.M. (band)', options)).toBe(true);
  });
});
