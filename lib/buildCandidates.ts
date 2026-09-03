// ======================================================================
// BUILD CANDIDATES
// ======================================================================
//
// Stateless. Reads CONFIG.rawFile (every tag string the API has ever returned, unfiltered) and
// CONFIG.blocklistFile, and writes CONFIG.outputFile: every valid tag, grouped by slug, with any
// multi-tag string split into its individual parts (see lib/splitMultiTag.ts).
//
// This is fully regenerated on every run - there is no incremental/seen-file state. Re-running this
// script is always safe and always produces the same output for the same raw tag list.
//
// Output shape: { [slug]: { variants: string[], parts?: string[], primary?: string } }
// - variants: every raw string (or split part) that slugifies to this slug
// - parts/primary: only present when this slug is itself a compound (its raw string split into >1 part) -
//   see lib/selectPrimaryTag.ts for how the default primary is chosen
//
// A tag/part is dropped if it fails isValidTag or slugifies to a blocklisted tag (see
// data/blocklist.json - checked by slug, since blocklist entries and raw tags may differ in casing).
//
// Usage: npm run tags:candidates

import chalk from 'chalk';
import fs from 'fs';

import { isValidTag } from './isValidTag.ts';
import { selectPrimaryTag } from './selectPrimaryTag.ts';
import { slugifyTagName } from './slugifyTagName.ts';
import { splitMultiTag } from './splitMultiTag.ts';

// ======================================================================
// CONFIG
// ======================================================================

const CONFIG = {
  rawFile: './data/1-tags-raw.json',
  blocklistFile: './data/blocklist.json',
  outputFile: './data/2-candidates.json',

  // Length bounds passed to isValidTag - see lib/isValidTag.ts
  minTagLength: 2,
  maxTagLength: 128,
};

// ======================================================================
// TYPES
// ======================================================================

type CandidateEntry = { variants: string[]; parts?: string[]; primary?: string };

// ======================================================================
// MAIN
// ======================================================================

function main(): void {
  console.log(chalk.bgCyan('# Building candidates'));

  const rawTags: string[] = JSON.parse(fs.readFileSync(CONFIG.rawFile, 'utf-8'));
  const blocklist: string[] = JSON.parse(fs.readFileSync(CONFIG.blocklistFile, 'utf-8'));
  const blockedSlugs = new Set(blocklist.map((tag) => slugifyTagName(tag)));

  const validationOptions = { minLength: CONFIG.minTagLength, maxLength: CONFIG.maxTagLength };
  const isKeepable = (tag: string) => isValidTag(tag, validationOptions) && !blockedSlugs.has(slugifyTagName(tag));

  const candidates: Record<string, CandidateEntry> = {};
  const addVariant = (tag: string) => {
    const slug = slugifyTagName(tag);

    if (!slug) {
      return;
    }

    const entry = (candidates[slug] ??= { variants: [] });

    if (!entry.variants.includes(tag)) {
      entry.variants.push(tag);
    }
  };

  let rejected = 0;
  let compoundCount = 0;

  for (const tag of rawTags) {
    if (!isKeepable(tag)) {
      rejected += 1;
      continue;
    }

    addVariant(tag);

    const allParts = splitMultiTag(tag);
    const parts = allParts.filter(isKeepable);

    if (parts.length > 1) {
      compoundCount += 1;

      const slug = slugifyTagName(tag);
      const entry = candidates[slug];
      const partSlugs = parts.map((part) => slugifyTagName(part));

      entry.parts ??= partSlugs;
      entry.primary ??= slugifyTagName(selectPrimaryTag(parts));

      for (const part of parts) {
        addVariant(part);
      }
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(candidates).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  );

  fs.writeFileSync(CONFIG.outputFile, `${JSON.stringify(sorted, null, 2)}\n`);

  console.log(
    chalk.green(`✓ Processed ${rawTags.length} raw tag(s): ${rejected} rejected, ${compoundCount} compound(s) found`)
  );
  console.log(chalk.bgCyan(`✓ ${CONFIG.outputFile} now has ${Object.keys(sorted).length} candidate slug(s)`));
}

main();
