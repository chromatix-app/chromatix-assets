// ======================================================================
// CURATED TAGS (EXCEPTIONS)
// ======================================================================
//
// Loads and validates data/3-tags-curated.json - the hand-maintained exceptions to the automatic
// resolution rules (see lib/resolveTag.ts). Everything the rules can derive on their own (the large
// majority of tags) is NOT in this file; it only holds what a human decided the rules get wrong:
//   - canonical: pin a tag as its own image (overriding a rule that would collapse it), and/or give it a
//     display name the generator should use instead of the derived one
//   - aliases / related: map a slug to another tag's image when no rule derives it (typos, translations,
//     acronyms, editorial "this niche tag borrows that image" calls)
//   - junk: strings that are not a genre/mood/style but can't be caught structurally (artists, labels)
//
// A slug may appear in at most one place across canonical keys / aliases / related / junk.

import fs from 'fs';

// ======================================================================
// TYPES
// ======================================================================

type CanonicalEntry = { name?: string; aliases: string[]; related: string[] };
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
 * Validates a curated tags structure, returning a list of human-readable problems (empty if valid): every
 * slug (canonical key, alias, related, junk) appears in at most one place, and every entry's arrays are
 * present. Whether an alias/related target actually exists is checked at build time (lib/resolveTag.ts),
 * since targets may be tags the rules derive rather than keys in this file.
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

  for (const slug of Object.keys(curated.canonical)) {
    claim(slug, 'canonical');
  }

  for (const [slug, entry] of Object.entries(curated.canonical)) {
    if (!Array.isArray(entry.aliases) || !Array.isArray(entry.related)) {
      errors.push(`"${slug}" must have "aliases" and "related" arrays`);
      continue;
    }

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
