/**
 * Picks which of a compound tag's parts (see lib/splitMultiTag.ts) is its primary - the part whose image the
 * compound shares. Prefers the first part that doesn't start with a modifier word (config/modifiers.json
 * "prefix"), so "Rock" beats "Adult Alternative Pop" in "Adult Alternative Pop & Rock"; if every part starts
 * with one, falls back to the first part. Pure and deterministic - the same parts and modifiers always give
 * the same answer.
 * @param parts - The compound tag's parts, in original order
 * @param prefixModifiers - Words that make a part a weaker primary candidate when they lead it
 * @returns The part to use as the compound's primary
 */
export function selectPrimaryTag(parts: string[], prefixModifiers: string[]): string {
  const modifiers = new Set(prefixModifiers.map((word) => word.toLowerCase()));
  const nonQualifying = parts.find((part) => !modifiers.has(part.split(/\s+/)[0].toLowerCase()));

  return nonQualifying ?? parts[0];
}
