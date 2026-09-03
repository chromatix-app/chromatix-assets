// ======================================================================
// RESOLVE TAG
// ======================================================================
//
// The one place that decides which image a tag slug shows. Pure and deterministic: the answer is a
// function of the slug, the candidate set (data/2-candidates.json), the hand-maintained exceptions
// (data/3-tags-curated.json) and the config lists (config/*.json) - never of which image files happen to
// exist. Re-run with the same inputs and you get the same map; change a config list and every affected
// tag re-resolves on the next build.
//
// Rules, in order (first match wins):
//   1. exceptions: junk / explicit alias / explicit related / pinned canonical
//   2. hyphenation: "bossanova" and "bossa-nova" are the same tag - a pinned spelling wins, else the
//      fewest-hyphen one
//   3. modifiers: strip a config prefix ("classic-rock" -> "rock") or suffix ("acoustic-music" ->
//      "acoustic") when the remainder is a known tag; the tag then shares the remainder's image
//   4. compound: a tag that split into parts shares its primary part's image (next part if that's junk)
//   5. otherwise the tag is canonical - its own image
// Every rule that maps to another slug resolves that slug recursively, so chains and overrides compose.

import { type CuratedTags } from './curatedTags.ts';
import { type PipelineConfig } from './config.ts';

// ======================================================================
// TYPES
// ======================================================================

type CandidateEntry = { variants: string[]; parts?: string[]; primary?: string };
export type Candidates = Record<string, CandidateEntry>;

type ResolutionKind = 'canonical' | 'alias' | 'related' | 'junk';
type Resolution = {
  kind: ResolutionKind;
  // The canonical slug whose image this tag shows; null for junk
  target: string | null;
  // Which rule decided it, e.g. "exception:alias", "hyphenation", "modifier:classic", "compound", "default"
  via: string;
};

export type Resolver = {
  resolve: (slug: string) => Resolution;
  // Display name for a canonical slug: the curated override, else the best-cased raw variant
  displayName: (slug: string) => string;
};

// ======================================================================
// RESOLVER
// ======================================================================

/**
 * Builds a resolver over a candidate set, the curated exceptions and the config lists. See the header
 * comment for the rule order. Results are memoised; a cycle in the exceptions (a -> b -> a) throws.
 * @param candidates - Every known tag slug with its raw variants (data/2-candidates.json)
 * @param curated - Hand-maintained exceptions (data/3-tags-curated.json)
 * @param config - Config lists (config/*.json)
 * @returns A resolver with resolve(slug) and displayName(slug)
 */
export function createResolver(candidates: Candidates, curated: CuratedTags, config: PipelineConfig): Resolver {
  const junk = new Set(curated.junk);
  const pinned = new Set(Object.keys(curated.canonical));
  const aliasOf = new Map<string, string>();
  const relatedOf = new Map<string, string>();

  for (const [canonicalSlug, entry] of Object.entries(curated.canonical)) {
    entry.aliases.forEach((alias) => aliasOf.set(alias, canonicalSlug));
    entry.related.forEach((related) => relatedOf.set(related, canonicalSlug));
  }

  const isKnown = (slug: string) =>
    slug in candidates || pinned.has(slug) || aliasOf.has(slug) || relatedOf.has(slug) || junk.has(slug);

  // Hyphenation: group candidate slugs by their hyphen-less form. Which spelling holds the image is
  // invisible to the app (both resolve to it), so the rule only needs to be STABLE: a pinned member if
  // there is exactly one (an exception decides - "hip-hop" over "hiphop"), else the spelling with the
  // fewest hyphens, then alphabetical. No string heuristic gets the established spelling right every
  // time ("britpop" but "hip-hop"); pin the ones that matter.
  const squashRepresentative = new Map<string, string>();

  for (const [squashed, group] of groupBy(Object.keys(candidates), (slug) => slug.replaceAll('-', ''))) {
    const pinnedMembers = group.filter((slug) => pinned.has(slug));
    const representative =
      pinnedMembers.length === 1
        ? pinnedMembers[0]
        : [...group].sort((a, b) => hyphenCount(a) - hyphenCount(b) || a.localeCompare(b))[0];

    squashRepresentative.set(squashed, representative);
  }

  const memo = new Map<string, Resolution>();
  const visiting = new Set<string>();

  function resolve(slug: string): Resolution {
    const cached = memo.get(slug);

    if (cached) {
      return cached;
    }

    if (visiting.has(slug)) {
      throw new Error(`Cycle in curated tags while resolving "${slug}" - check aliases/related in 3-tags-curated.json`);
    }

    visiting.add(slug);
    const result = resolveUncached(slug);
    visiting.delete(slug);
    memo.set(slug, result);

    return result;
  }

  // Resolves `slug` by pointing it at `target`: the final image is whatever `target` resolves to, and if
  // `target` turns out to be junk then so is `slug`.
  function chain(kind: ResolutionKind, target: string, via: string): Resolution {
    const resolved = resolve(target);

    if (resolved.kind === 'junk') {
      return { kind: 'junk', target: null, via: `${via} -> junk` };
    }

    return { kind, target: resolved.target, via };
  }

  function resolveUncached(slug: string): Resolution {
    // 1. Exceptions
    if (junk.has(slug)) {
      return { kind: 'junk', target: null, via: 'exception:junk' };
    }

    if (aliasOf.has(slug)) {
      return chain('alias', aliasOf.get(slug)!, 'exception:alias');
    }

    if (relatedOf.has(slug)) {
      return chain('related', relatedOf.get(slug)!, 'exception:related');
    }

    if (pinned.has(slug)) {
      return { kind: 'canonical', target: slug, via: 'exception:canonical' };
    }

    // 2. Hyphenation
    const representative = squashRepresentative.get(slug.replaceAll('-', ''));

    if (representative && representative !== slug) {
      return chain('alias', representative, 'hyphenation');
    }

    // 3. Modifiers
    for (const prefix of config.modifiers.prefix) {
      const lead = `${prefix.toLowerCase()}-`;

      if (slug.startsWith(lead) && isKnown(slug.slice(lead.length))) {
        return chain('related', slug.slice(lead.length), `modifier:${prefix}`);
      }
    }

    for (const suffix of config.modifiers.suffix) {
      const trail = `-${suffix.toLowerCase()}`;

      if (slug.endsWith(trail) && isKnown(slug.slice(0, -trail.length))) {
        return chain('related', slug.slice(0, -trail.length), `modifier:${suffix}`);
      }
    }

    // 4. Compound
    const entry = candidates[slug];

    if (entry?.parts && entry.parts.length > 1) {
      const ordered = [entry.primary, ...entry.parts].filter((part): part is string => part !== undefined);

      for (const part of new Set(ordered)) {
        if (part === slug) {
          continue;
        }

        const resolved = resolve(part);

        if (resolved.kind !== 'junk') {
          return { kind: 'alias', target: resolved.target, via: 'compound' };
        }
      }

      return { kind: 'junk', target: null, via: 'compound -> all parts junk' };
    }

    // 5. Canonical
    return { kind: 'canonical', target: slug, via: 'default' };
  }

  function displayName(slug: string): string {
    const override = curated.canonical[slug]?.name;

    if (override) {
      return override;
    }

    // Prefer a mixed-case variant ("Classic Rock"), then all-caps (acronyms: "EDM", "R&B"), then
    // title-case an all-lowercase one. Shortest wins within a group, so noisy long variants lose.
    const variants = candidates[slug]?.variants ?? [];
    const shortest = (pool: string[]) => [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    const mixedCase = variants.filter((v) => v !== v.toUpperCase() && v !== v.toLowerCase());
    const upperCase = variants.filter((v) => v === v.toUpperCase() && v !== v.toLowerCase());

    if (mixedCase.length > 0) {
      return shortest(mixedCase);
    }

    if (upperCase.length > 0) {
      return shortest(upperCase);
    }

    return titleCase(variants.length > 0 ? shortest(variants) : slug);
  }

  return { resolve, displayName };
}

/**
 * Resolves every candidate slug and returns the flat runtime map deployed as data/4-tags-resolved.json:
 * each non-junk slug -> the canonical slug whose image it shows (canonical slugs map to themselves).
 * @param candidates - Every known tag slug (data/2-candidates.json)
 * @param resolver - A resolver from createResolver
 * @returns The map, keys sorted case-insensitively
 */
export function buildResolvedMap(candidates: Candidates, resolver: Resolver): Record<string, string> {
  const map: Record<string, string> = {};

  for (const slug of Object.keys(candidates)) {
    const resolution = resolver.resolve(slug);

    if (resolution.target) {
      map[slug] = resolution.target;
    }
  }

  return Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  );
}

// ======================================================================
// HELPERS
// ======================================================================

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }

  return groups;
}

function hyphenCount(slug: string): number {
  return slug.split('-').length - 1;
}

function titleCase(text: string): string {
  return text
    .split(/[-\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
