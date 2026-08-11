const DIACRITICS = /[̀-ͯ]/g;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const LEADING_TRAILING_HYPHENS = /^-+|-+$/g;

/**
 * Converts a tag name into a consistent lowercase, hyphenated slug for use as a filename:
 * strips accents/diacritics (e.g. "é" -> "e"), lowercases, replaces "&" with "and", and collapses any
 * other non-alphanumeric characters into hyphens.
 * @param tag - The tag name to slugify
 * @returns The slugified tag name
 */
export function slugifyTagName(tag: string): string {
  return tag
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(NON_ALPHANUMERIC, '-')
    .replace(LEADING_TRAILING_HYPHENS, '');
}
