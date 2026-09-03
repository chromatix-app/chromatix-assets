import { describe, expect, it } from 'vitest';

import { type CuratedTags, resolveSlug, validateCurated } from './curatedTags.ts';

describe('validateCurated', () => {
  it('accepts a well-formed curated structure', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { name: 'Rock', aliases: ['rok'], related: ['meme-rock'] },
        pop: { name: 'Pop', aliases: [], related: [] },
      },
      junk: ['misc'],
    };

    expect(validateCurated(curated)).toEqual([]);
  });

  it('rejects a slug used as both a canonical key and an alias', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { name: 'Rock', aliases: ['pop'], related: [] },
        pop: { name: 'Pop', aliases: [], related: [] },
      },
      junk: [],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"pop"')]);
  });

  it('rejects the same alias appearing under two different canonical entries', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { name: 'Rock', aliases: ['rok'], related: [] },
        pop: { name: 'Pop', aliases: ['rok'], related: [] },
      },
      junk: [],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rok"')]);
  });

  it('rejects a slug appearing as both an alias and in junk', () => {
    const curated: CuratedTags = {
      canonical: { rock: { name: 'Rock', aliases: ['rok'], related: [] } },
      junk: ['rok'],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rok"')]);
  });

  it('rejects a slug appearing as both a canonical key and in junk', () => {
    const curated: CuratedTags = {
      canonical: { rock: { name: 'Rock', aliases: [], related: [] } },
      junk: ['rock'],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rock"')]);
  });

  it('rejects a slug used as both an alias and a related tag (even under the same entry)', () => {
    const curated: CuratedTags = {
      canonical: { rock: { name: 'Rock', aliases: ['rok'], related: ['rok'] } },
      junk: [],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rok"')]);
  });

  it('reports multiple independent problems at once', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { name: 'Rock', aliases: ['pop'], related: [] },
        pop: { name: 'Pop', aliases: [], related: [] },
      },
      junk: ['pop', 'misc', 'misc'],
    };

    expect(validateCurated(curated).length).toBeGreaterThan(1);
  });
});

describe('resolveSlug', () => {
  const curated: CuratedTags = {
    canonical: {
      rock: { name: 'Rock', aliases: ['rok', 'rock-music'], related: ['mathematic-metal'] },
    },
    junk: ['misc'],
  };

  it('resolves a canonical slug to itself', () => {
    expect(resolveSlug(curated, 'rock')).toBe('rock');
  });

  it('resolves an alias to its canonical slug', () => {
    expect(resolveSlug(curated, 'rok')).toBe('rock');
    expect(resolveSlug(curated, 'rock-music')).toBe('rock');
  });

  it('resolves a related tag to its canonical slug', () => {
    expect(resolveSlug(curated, 'mathematic-metal')).toBe('rock');
  });

  it('returns null for a junk slug', () => {
    expect(resolveSlug(curated, 'misc')).toBeNull();
  });

  it('returns null for a slug not present anywhere in the curated data', () => {
    expect(resolveSlug(curated, 'some-undecided-tag')).toBeNull();
  });
});
