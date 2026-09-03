import { describe, expect, it } from 'vitest';

import { type PipelineConfig } from './config.ts';
import { type CuratedTags } from './curatedTags.ts';
import { type Candidates, buildResolvedMap, createResolver } from './resolveTag.ts';

const config: PipelineConfig = {
  blocklist: [],
  modifiers: { prefix: ['classic', 'general'], suffix: ['music'] },
  delimiters: { separators: [','], connectors: ['&', 'and'], distributiveHeads: ['metal'] },
  compoundTags: [],
};

const noExceptions: CuratedTags = { canonical: {}, junk: [] };

const candidates: Candidates = {
  rock: { variants: ['Rock', 'rock'] },
  'classic-rock': { variants: ['Classic Rock'] },
  'general-classic-rock': { variants: ['General Classic Rock'] },
  'acoustic-music': { variants: ['Acoustic Music'] },
  acoustic: { variants: ['Acoustic'] },
  'death-metal': { variants: ['Death Metal'] },
  metal: { variants: ['Metal'] },
  'bossa-nova': { variants: ['Bossa Nova'] },
  bossanova: { variants: ['Bossanova'] },
  'rock-and-pop': { variants: ['Rock & Pop'], parts: ['rock', 'pop'], primary: 'rock' },
  pop: { variants: ['Pop'] },
  'misc-and-rock': { variants: ['Misc & Rock'], parts: ['misc', 'rock'], primary: 'misc' },
  misc: { variants: ['Misc'] },
  'r-and-b': { variants: ['R&B', 'r&b'] },
  edm: { variants: ['EDM'] },
};

describe('createResolver', () => {
  const resolver = createResolver(candidates, noExceptions, config);

  it('makes a plain tag canonical by default', () => {
    expect(resolver.resolve('rock')).toEqual({ kind: 'canonical', target: 'rock', via: 'default' });
  });

  it('strips a configured prefix when the remainder is a known tag', () => {
    expect(resolver.resolve('classic-rock')).toEqual({ kind: 'related', target: 'rock', via: 'modifier:classic' });
  });

  it('strips modifiers repeatedly', () => {
    expect(resolver.resolve('general-classic-rock')).toMatchObject({ kind: 'related', target: 'rock' });
  });

  it('strips a configured suffix', () => {
    expect(resolver.resolve('acoustic-music')).toEqual({ kind: 'related', target: 'acoustic', via: 'modifier:music' });
  });

  it('never strips a word that is not configured, even if the remainder exists', () => {
    expect(resolver.resolve('death-metal')).toEqual({ kind: 'canonical', target: 'death-metal', via: 'default' });
  });

  it('treats hyphenation variants as one tag, preferring the spelling with fewest hyphens', () => {
    expect(resolver.resolve('bossa-nova')).toEqual({ kind: 'alias', target: 'bossanova', via: 'hyphenation' });
    expect(resolver.resolve('bossanova').kind).toBe('canonical');
  });

  it('ignores how many raw variants back each hyphenation spelling (stability over popularity)', () => {
    const withVariants: Candidates = {
      ...candidates,
      'hip-hop': { variants: ['Hip-Hop', 'Hip Hop', 'hip hop'] },
      hiphop: { variants: ['HipHop'] },
    };
    const r = createResolver(withVariants, noExceptions, config);

    expect(r.resolve('hip-hop')).toEqual({ kind: 'alias', target: 'hiphop', via: 'hyphenation' });
  });

  it('lets a pinned exception choose the hyphenation representative', () => {
    const pinnedResolver = createResolver(
      candidates,
      { canonical: { 'bossa-nova': { aliases: [], related: [] } }, junk: [] },
      config
    );

    expect(pinnedResolver.resolve('bossanova')).toEqual({ kind: 'alias', target: 'bossa-nova', via: 'hyphenation' });
    expect(pinnedResolver.resolve('bossa-nova').via).toBe('exception:canonical');
  });

  it('points a compound at its primary part', () => {
    expect(resolver.resolve('rock-and-pop')).toEqual({ kind: 'alias', target: 'rock', via: 'compound' });
  });

  it('skips a junk primary and uses the next part', () => {
    const withJunk = createResolver(candidates, { canonical: {}, junk: ['misc'] }, config);

    expect(withJunk.resolve('misc-and-rock')).toEqual({ kind: 'alias', target: 'rock', via: 'compound' });
  });

  it('is junk when every part is junk', () => {
    const withJunk = createResolver(candidates, { canonical: {}, junk: ['misc', 'rock'] }, config);

    expect(withJunk.resolve('misc-and-rock').kind).toBe('junk');
  });

  it('prefers a raw part over a fragment primary when sharing a compound image', () => {
    const withFragmentPrimary: Candidates = {
      ...candidates,
      'death-and-black-metal': {
        variants: ['Death & Black Metal'],
        parts: ['death', 'black-metal'],
        primary: 'death',
      },
      death: { variants: ['Death'], raw: false },
      'black-metal': { variants: ['Black Metal'], raw: true },
    };
    const r = createResolver(withFragmentPrimary, noExceptions, config);

    expect(r.resolve('death-and-black-metal')).toEqual({ kind: 'alias', target: 'black-metal', via: 'compound' });
  });
});

describe('createResolver with exceptions', () => {
  const exceptions: CuratedTags = {
    canonical: {
      'classic-rock': { name: 'Classic Rock', aliases: ['klassik-rock'], related: [] },
      metal: { aliases: [], related: ['death-metal'] },
    },
    junk: ['edm'],
  };
  const resolver = createResolver(candidates, exceptions, config);

  it('lets a pinned canonical entry override a modifier rule', () => {
    expect(resolver.resolve('classic-rock')).toEqual({
      kind: 'canonical',
      target: 'classic-rock',
      via: 'exception:canonical',
    });
  });

  it('applies explicit aliases and related entries, chaining to the final canonical', () => {
    expect(resolver.resolve('klassik-rock')).toEqual({ kind: 'alias', target: 'classic-rock', via: 'exception:alias' });
    expect(resolver.resolve('death-metal')).toEqual({ kind: 'related', target: 'metal', via: 'exception:related' });
  });

  it('applies junk', () => {
    expect(resolver.resolve('edm')).toEqual({ kind: 'junk', target: null, via: 'exception:junk' });
  });

  it('makes a slug junk if its alias target is junk', () => {
    const chained = createResolver(
      candidates,
      { canonical: { rock: { aliases: ['pop'], related: [] } }, junk: ['rock'] },
      config
    );

    expect(chained.resolve('pop').kind).toBe('junk');
  });

  it('throws on a cycle', () => {
    const cyclic: CuratedTags = {
      canonical: {
        rock: { aliases: [], related: ['pop'] },
      },
      junk: [],
    };
    const cyclicCandidates: Candidates = { ...candidates, pop: { variants: ['Pop'] } };
    const cyc = createResolver(
      cyclicCandidates,
      { canonical: { ...cyclic.canonical, pop: { aliases: [], related: ['rock'] } }, junk: [] },
      config
    );

    expect(() => cyc.resolve('rock')).toThrow(/appears in more than one place|Cycle/);
  });
});

describe('displayName', () => {
  const resolver = createResolver(
    candidates,
    { canonical: { rock: { name: 'ROCK!', aliases: [], related: [] } }, junk: [] },
    config
  );

  it('uses the curated override when present', () => {
    expect(resolver.displayName('rock')).toBe('ROCK!');
  });

  it('prefers a mixed-case raw variant', () => {
    expect(resolver.displayName('classic-rock')).toBe('Classic Rock');
  });

  it('keeps an all-caps variant like an acronym as-is', () => {
    expect(resolver.displayName('r-and-b')).toBe('R&B');
    expect(resolver.displayName('edm')).toBe('EDM');
  });

  it('title-cases an unknown slug', () => {
    expect(resolver.displayName('some-new-thing')).toBe('Some New Thing');
  });
});

describe('buildResolvedMap', () => {
  it('maps every non-junk slug to its canonical slug, canonical slugs to themselves', () => {
    const resolver = createResolver(candidates, { canonical: {}, junk: ['misc'] }, config);
    const map = buildResolvedMap(candidates, resolver);

    expect(map['rock']).toBe('rock');
    expect(map['classic-rock']).toBe('rock');
    expect(map['bossa-nova']).toBe('bossanova');
    expect(map['rock-and-pop']).toBe('rock');
    expect(map['misc-and-rock']).toBe('rock');
    expect(map).not.toHaveProperty('misc');
  });

  it('excludes an unreferenced fragment but keeps one another slug resolves to', () => {
    const withFragments: Candidates = {
      ...candidates,
      // "death" only ever appeared as a split part and nothing points at it - must not appear in the map.
      death: { variants: ['Death'], raw: false },
      // "black-metal" is also a fragment-only slug, but "death-and-black-metal" resolves to it (it's the
      // primary), so it stays in the map.
      'black-metal': { variants: ['Black Metal'], raw: false },
      'death-and-black-metal': {
        variants: ['Death & Black Metal'],
        parts: ['death', 'black-metal'],
        primary: 'black-metal',
      },
    };
    const resolver = createResolver(withFragments, noExceptions, config);
    const map = buildResolvedMap(withFragments, resolver);

    expect(map).not.toHaveProperty('death');
    expect(map['black-metal']).toBe('black-metal');
    expect(map['death-and-black-metal']).toBe('black-metal');
  });
});
