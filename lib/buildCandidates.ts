// ======================================================================
// BUILD CANDIDATES
// ======================================================================
//
// Stateless. Reads CONFIG.rawFile (every tag string the API has ever returned, unfiltered) and writes
// CONFIG.outputFile: every valid tag grouped by slug, with any multi-tag string split into its parts
// (config/delimiters.json, config/compound-tags.json). Fully regenerated on every run - same raw list
// and config in, same file out.
//
// Output shape: { [slug]: { variants: string[], raw: boolean, parts?: string[], primary?: string } }
// - variants: every raw string (or split part) that slugifies to this slug
// - raw: true if at least one raw tag string (not just a split part) slugifies directly to this slug
// - parts/primary: only when the slug is itself a compound (see lib/selectPrimaryTag.ts for primary)
//
// A tag/part is dropped if it fails isValidTag or slugifies to a config/blocklist.json entry.
//
// Usage: npm run tags:candidates

import chalk from 'chalk';
import fs from 'fs';

import { loadConfig } from './config.ts';
import { isValidTag } from './isValidTag.ts';
import { selectPrimaryTag } from './selectPrimaryTag.ts';
import { slugifyTagName } from './slugifyTagName.ts';
import { splitMultiTag } from './splitMultiTag.ts';

// ======================================================================
// CONFIG
// ======================================================================

const CONFIG = {
  rawFile: './data/1-tags-raw.json',
  outputFile: './data/2-candidates.json',

  // Length bounds passed to isValidTag - see lib/isValidTag.ts
  minTagLength: 2,
  maxTagLength: 128,
};

// ======================================================================
// TYPES
// ======================================================================

type CandidateEntry = { variants: string[]; raw: boolean; parts?: string[]; primary?: string };

// ======================================================================
// MAIN
// ======================================================================

function main(): void {
  console.log(chalk.bgCyan('# Building candidates'));

  const config = loadConfig();
  const rawTags: string[] = JSON.parse(fs.readFileSync(CONFIG.rawFile, 'utf-8'));
  const blockedSlugs = new Set(config.blocklist.map((tag) => slugifyTagName(tag)));

  const validationOptions = { minLength: CONFIG.minTagLength, maxLength: CONFIG.maxTagLength };
  const isKeepable = (tag: string) => isValidTag(tag, validationOptions) && !blockedSlugs.has(slugifyTagName(tag));

  const splitOptions = {
    separators: config.delimiters.separators,
    connectors: config.delimiters.connectors,
    protectedTags: config.compoundTags,
    distributiveHeads: config.delimiters.distributiveHeads,
  };

  const candidates: Record<string, CandidateEntry> = {};
  const addVariant = (tag: string, isRaw: boolean) => {
    const slug = slugifyTagName(tag);

    if (!slug) {
      return;
    }

    const entry = (candidates[slug] ??= { variants: [], raw: false });

    if (!entry.variants.includes(tag)) {
      entry.variants.push(tag);
    }

    entry.raw ||= isRaw;
  };

  let rejected = 0;
  let compoundCount = 0;

  for (const tag of rawTags) {
    if (!isKeepable(tag)) {
      rejected += 1;
      continue;
    }

    addVariant(tag, true);

    const parts = splitMultiTag(tag, splitOptions).filter(isKeepable);

    if (parts.length > 1) {
      compoundCount += 1;

      const entry = candidates[slugifyTagName(tag)];

      entry.parts ??= parts.map((part) => slugifyTagName(part));
      entry.primary ??= slugifyTagName(selectPrimaryTag(parts, config.modifiers.prefix));

      parts.forEach((part) => addVariant(part, false));
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
