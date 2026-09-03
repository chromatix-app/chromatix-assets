import { describe, expect, it } from 'vitest';

import { type CuratedTags, validateCurated } from './curatedTags.ts';

describe('validateCurated', () => {
  it('accepts a well-formed curated structure', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { name: 'Rock', aliases: ['rok'], related: ['meme-rock'] },
        pop: { aliases: [], related: [] },
      },
      junk: ['misc'],
    };

    expect(validateCurated(curated)).toEqual([]);
  });

  it('rejects a slug used as both a canonical key and an alias', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { aliases: ['pop'], related: [] },
        pop: { aliases: [], related: [] },
      },
      junk: [],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"pop"')]);
  });

  it('rejects the same alias appearing under two different canonical entries', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { aliases: ['rok'], related: [] },
        pop: { aliases: ['rok'], related: [] },
      },
      junk: [],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rok"')]);
  });

  it('rejects a slug appearing as both an alias and in junk', () => {
    const curated: CuratedTags = {
      canonical: { rock: { aliases: ['rok'], related: [] } },
      junk: ['rok'],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rok"')]);
  });

  it('rejects a slug appearing as both a canonical key and in junk', () => {
    const curated: CuratedTags = {
      canonical: { rock: { aliases: [], related: [] } },
      junk: ['rock'],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rock"')]);
  });

  it('rejects a slug used as both an alias and a related tag, even under the same entry', () => {
    const curated: CuratedTags = {
      canonical: { rock: { aliases: ['rok'], related: ['rok'] } },
      junk: [],
    };

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rok"')]);
  });

  it('rejects an entry missing its arrays', () => {
    const curated = { canonical: { rock: { name: 'Rock' } }, junk: [] } as unknown as CuratedTags;

    expect(validateCurated(curated)).toEqual([expect.stringContaining('"rock"')]);
  });

  it('reports multiple independent problems at once', () => {
    const curated: CuratedTags = {
      canonical: {
        rock: { aliases: ['pop'], related: [] },
        pop: { aliases: [], related: [] },
      },
      junk: ['pop', 'misc', 'misc'],
    };

    expect(validateCurated(curated).length).toBeGreaterThan(1);
  });
});
