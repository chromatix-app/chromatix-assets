// ======================================================================
// CURATED TAGS
// ======================================================================
//
// Loads and validates data/3-tags-curated.json - the only durable, hand/LLM-edited file in the tag
// resolution design (see spec.md §3.2). Every other data file (2-candidates.json, 4-tags-resolved.json) is
// mechanically derived; this one is not, so it's validated on every load rather than trusted blindly.
//
// A slug may appear in at most one place across: a canonical key, an alias (of any canonical entry), a
// related tag (of any canonical entry), or junk. Every alias/related target must itself be a canonical
// key (no chains - an alias can't point at another alias).

import fs from 'fs';

// ======================================================================
// TYPES
// ======================================================================

export type CanonicalEntry = { name: string; aliases: string[]; related: string[] };
export type CuratedTags = { canonical: Record<string, CanonicalEntry>; junk: string[] };

// ======================================================================
// LOADING
// ======================================================================

const DEFAULT_CURATED_FILE = './data/3-tags-curated.json';

/**
 * Reads and validates data/3-tags-curated.json (or the given path). Throws with a description of every
 * problem found if the file is malformed - see validateCurated for what's checked.
 * @param path - Path to the curated tags file
 * @returns The parsed, validated curated tags data
 */
export function loadCurated(path: string = DEFAULT_CURATED_FILE): CuratedTags {
  const curated: CuratedTags = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const errors = validateCurated(curated);

  if (errors.length > 0) {
    throw new Error(`Invalid curated tags file (${path}):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  return curated;
}

// ======================================================================
// VALIDATION
// ======================================================================

/**
 * Validates a curated tags structure, returning a list of human-readable problems (empty if valid):
 * every slug (canonical key, alias, related, junk) appears in at most one place, and every alias/related
 * target is itself a canonical key (not another alias, not missing).
 * @param curated - The curated tags data to validate
 * @returns A list of validation error messages, empty if the data is valid
 */
export function validateCurated(curated: CuratedTags): string[] {
  const errors: string[] = [];
  const owners = new Map<string, string>();

  const claim = (slug: string, location: string) => {
    const existing = owners.get(slug);

    if (existing) {
      errors.push(`"${slug}" appears in more than one place: ${existing} and ${location}`);
    } else {
      owners.set(slug, location);
    }
  };

  for (const [slug] of Object.entries(curated.canonical)) {
    claim(slug, 'canonical');
  }

  for (const [slug, entry] of Object.entries(curated.canonical)) {
    for (const alias of entry.aliases) {
      claim(alias, `alias of "${slug}"`);
    }

    for (const related of entry.related) {
      claim(related, `related to "${slug}"`);
    }
  }

  for (const slug of curated.junk) {
    claim(slug, 'junk');
  }

  return errors;
}

// ======================================================================
// RESOLUTION
// ======================================================================

/**
 * Resolves a slug to its canonical slug: the slug itself if it's already canonical, the canonical slug it
 * aliases or relates to, or null if the slug is junk or not present in the curated data at all (an
 * undecided candidate - see spec.md §3.3, lib/triageTags.ts).
 * @param curated - The curated tags data (see loadCurated)
 * @param slug - The slug to resolve
 * @returns The canonical slug, or null if there is none
 */
export function resolveSlug(curated: CuratedTags, slug: string): string | null {
  if (curated.canonical[slug]) {
    return slug;
  }

  for (const [canonicalSlug, entry] of Object.entries(curated.canonical)) {
    if (entry.aliases.includes(slug) || entry.related.includes(slug)) {
      return canonicalSlug;
    }
  }

  return null;
}
