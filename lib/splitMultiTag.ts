export type SplitOptions = {
  // Split wherever these appear, e.g. "," or "|" (see config/delimiters.json)
  separators: string[];
  // Split on these only when surrounded by whitespace, e.g. "&" or "and" - so "R&B" stays whole
  connectors: string[];
  // Phrases that contain a connector as part of their own name and must never be split, e.g. "drum & bass"
  protectedTags: string[];
  // Single words (e.g. "metal", "rock") that, when they're the final word of the last split part, get
  // distributed onto every earlier single-word part - "Death & Black Metal" -> ["Death Metal", "Black Metal"]
  distributiveHeads: string[];
};

// Stands in for whitespace inside a protected phrase while splitting. Connectors only split when
// surrounded by real whitespace, so "drum&bass" survives; restored to spaces afterwards.
const PROTECTED_SPACE = '';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Rewrites every protected phrase in `tag` so its internal whitespace can't be seen by the split regex.
// Matched case-insensitively, as whole words, with any amount of whitespace between the phrase's words.
function protect(tag: string, protectedTags: string[]): string {
  let result = tag;

  for (const phrase of protectedTags) {
    const words = phrase.trim().split(/\s+/).map(escapeRegExp);
    const pattern = new RegExp(`(?<![a-z0-9])${words.join('\\s+')}(?![a-z0-9])`, 'gi');

    result = result.replace(pattern, (match) => match.replace(/\s+/g, PROTECTED_SPACE));
  }

  return result;
}

// Distributive-head rule: "Death & Black Metal" -> ["Death Metal", "Black Metal"]. Applied when there are
// >= 2 parts and the final part has >= 2 words whose last word (case-insensitively) is a listed head, AND
// every earlier part is a single word that doesn't already end with that head - otherwise parts are left
// untouched ("Ambient & New Age": "Age" isn't a head; "Rock & Pop": last part is one word; "Blue-Eyed Soul
// & Jazz Fusion & Alternative Rock": earlier parts are multi-word).
function applyDistributiveHead(parts: string[], distributiveHeads: string[]): string[] {
  if (parts.length < 2) {
    return parts;
  }

  const heads = new Set(distributiveHeads.map((head) => head.toLowerCase()));
  const last = parts[parts.length - 1];
  const lastWords = last.trim().split(/\s+/);

  if (lastWords.length < 2) {
    return parts;
  }

  const head = lastWords[lastWords.length - 1];

  if (!heads.has(head.toLowerCase())) {
    return parts;
  }

  const earlierParts = parts.slice(0, -1);
  const allEligible = earlierParts.every((part) => {
    const words = part.trim().split(/\s+/);

    return words.length === 1 && words[0].toLowerCase() !== head.toLowerCase();
  });

  if (!allEligible) {
    return parts;
  }

  return [...earlierParts.map((part) => `${part} ${head}`), last];
}

/**
 * Splits a raw tag string that joins several tags into its parts, using the separators/connectors from
 * config/delimiters.json ("Ambient & New Age", "Rock, Pop", "Metal | Deathcore", "Rock y Alternativo").
 * Connectors only split when surrounded by whitespace, so "R&B" is one tag. Phrases in
 * config/compound-tags.json survive intact even inside a longer list ("Drum & Bass & UK Garage" ->
 * ["Drum & Bass", "UK Garage"]). After splitting, a distributive head from config/delimiters.json
 * ("metal", "rock", ...) named by the last part ("Death & Black Metal") is appended to every earlier
 * single-word part, so "Death" doesn't become its own bare fragment: ["Death Metal", "Black Metal"].
 * Returns the original string as a single-element array if nothing splits.
 * @param tag - The raw tag string
 * @param options - Separators, connectors, protected phrases and distributive heads (see lib/config.ts)
 * @returns One or more trimmed, non-empty parts
 */
export function splitMultiTag(tag: string, options: SplitOptions): string[] {
  const alternatives: string[] = [];

  if (options.separators.length > 0) {
    alternatives.push(`\\s*(?:${options.separators.map(escapeRegExp).join('|')})\\s*`);
  }

  if (options.connectors.length > 0) {
    alternatives.push(`\\s+(?:${options.connectors.map(escapeRegExp).join('|')})\\s+`);
  }

  if (alternatives.length === 0) {
    return [tag];
  }

  const delimiter = new RegExp(alternatives.join('|'), 'gi');

  const parts = protect(tag, options.protectedTags)
    .split(delimiter)
    .map((part) => part.replaceAll(PROTECTED_SPACE, ' ').trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return [tag];
  }

  return applyDistributiveHead(parts, options.distributiveHeads);
}
