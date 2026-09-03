// Words that only ever describe an audience/era rather than naming a genre on their own, so a compound
// part starting with one of them is deprioritized as a fallback image in favour of another part - e.g.
// "Rock" is preferred over "Adult Alternative Pop" in "Adult Alternative Pop & Rock", since "Adult" only
// describes the target audience rather than naming a genre.
//
// Deliberately kept short: most leading words in a compound part (e.g. "Progressive", "Indie", "Classic",
// "Contemporary") are genuinely part of the genre name in some other tag (Progressive House, Indie Rock,
// Classic Rock, Contemporary Folk) and stripping them generically would misfire far more often than it
// helps - only add a word here once you've confirmed it never legitimately heads a real genre name on its
// own.
const QUALIFIER_WORDS = new Set(['adult']);

/**
 * Picks which of a compound tag's parts (see lib/splitMultiTag.ts) should be used as its default fallback
 * image, when the compound isn't given a dedicated image of its own. Prefers the first part that doesn't
 * start with a known pure qualifier word (see QUALIFIER_WORDS); if every part does, falls back to the
 * first part regardless. This is only ever a deterministic default proposal, not a final answer - see
 * lib/splitTags.ts, which writes this alongside every compound tag so it can be hand-overridden.
 * @param parts - The compound tag's individual parts, in original order
 * @returns The part to use as the compound's default primary/fallback
 */
export function selectPrimaryTag(parts: string[]): string {
  const nonQualifying = parts.find((part) => !QUALIFIER_WORDS.has(part.split(/\s+/)[0].toLowerCase()));

  return nonQualifying ?? parts[0];
}
