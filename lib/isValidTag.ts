// Matches a domain-like substring (e.g. "topmusic.rs", "cnhifi.com") so junk tags that are actually
// website plugs can be rejected without needing to list every one of them individually.
const DOMAIN_LIKE = /[a-z0-9-]+\.[a-z]{2,6}\b/i;

// Matches any Latin letter or digit, after diacritics are stripped (so "Électronique" counts but "Поп"
// or "アジア" don't). Checked directly against the tag rather than via slugifyTagName, since
// slugifyTagName replaces "&" with the literal word "and" - which would otherwise make a tag like
// "Фильмы & Игры" (Cyrillic only, plus a punctuation "&") slugify to "and" instead of empty.
const HAS_LATIN_ALPHANUMERIC = /[a-z0-9]/i;
const DIACRITICS = /[̀-ͯ]/g;

// Matches a tag made up entirely of digits (and optional surrounding whitespace), e.g. "13".
const ONLY_DIGITS = /^\d+$/;

// Matches bracket/paren/brace/angle-bracket characters, so they can be stripped before validating the
// text they contain - e.g. "(255)" is validated as "255" (fails ONLY_DIGITS), rather than being rejected
// via a dedicated "fully bracketed" shape check. This is deliberately narrower than that would've been:
// a tag like "<Unknown>" strips down to "Unknown", which passes every other rule here (it reads as a
// normal English word) and is therefore accepted - there's no algorithmic way to tell a placeholder word
// like that apart from a real one, so it isn't handled by isValidTag.
const BRACKETS = /[()[\]{}<>]/g;

export type TagValidationOptions = {
  minLength: number;
  maxLength: number;
};

/**
 * Determines whether a tag name is worth keeping in the tags list: once bracket characters are removed,
 * the remaining text must be within the given length bounds, not purely numeric (e.g. "13" or "(255)"),
 * and contain at least one Latin letter or digit (rules out tags made up entirely of non-Latin scripts -
 * Cyrillic, CJK, Hangul, etc. - which slugifyTagName has no transliteration for, even when combined with
 * punctuation like "&"). Separately, the original tag must not be domain/URL-like (e.g. "www.TopMusic.rs").
 * @param tag - The tag name to validate
 * @param options - Length bounds to validate against
 * @returns true if the tag should be kept
 */
export function isValidTag(tag: string, options: TagValidationOptions): boolean {
  if (DOMAIN_LIKE.test(tag)) {
    return false;
  }

  const withoutBrackets = tag.replace(BRACKETS, '').trim();

  if (withoutBrackets.length < options.minLength || withoutBrackets.length > options.maxLength) {
    return false;
  }

  if (ONLY_DIGITS.test(withoutBrackets)) {
    return false;
  }

  const normalized = withoutBrackets.normalize('NFD').replace(DIACRITICS, '');

  return HAS_LATIN_ALPHANUMERIC.test(normalized);
}
