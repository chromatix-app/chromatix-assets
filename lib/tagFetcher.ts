// ======================================================================
// TAG FETCHER
// ======================================================================
//
// Fetches the current tag list from the Chromatix API and merges it into CONFIG.tagsFile, keeping the
// file alphabetised with no duplicates. Tags listed in CONFIG.ignoredTagsFile, or outside the
// CONFIG.minTagLength/maxTagLength range, are dropped even if the API returns them.
//
// Usage: npm run tags:fetch

import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

// ======================================================================
// CONFIG
// ======================================================================

const CONFIG = {
  // API endpoint to fetch tags from
  apiUrl: process.env.TAGS_API_URL,

  // Origin header required by the API - set in .env.local since it's tied to the calling machine/app
  apiOrigin: process.env.TAGS_API_ORIGIN,

  // Output file to merge fetched tags into
  tagsFile: './data/tags.json',

  // Tags to always exclude from the output file, even if the API returns them
  ignoredTagsFile: './data/tags-ignored.json',

  // Minimum tag length
  minTagLength: 2,

  // Maximum tag length
  maxTagLength: 128,
};

// ======================================================================
// TYPES
// ======================================================================

type TagsResponse = {
  success: boolean;
  total: number;
  tags: string[];
};

// ======================================================================
// MAIN
// ======================================================================

async function fetchTags(): Promise<string[]> {
  const response = await fetch(CONFIG.apiUrl!, {
    headers: { 'X-Api-Key': process.env.TAGS_API_KEY!, Origin: CONFIG.apiOrigin! },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API request failed with status ${response.status}: ${body}`);
  }

  const data = (await response.json()) as TagsResponse;

  if (!data.success) {
    throw new Error('API response reported success: false');
  }

  return data.tags;
}

// Merges fetchedTags into the existing tags file, excluding ignoredTags and tags outside the
// CONFIG.minTagLength/maxTagLength range, deduplicating, and sorting alphabetically (case-insensitive).
function mergeTags(existingTags: string[], fetchedTags: string[], ignoredTags: string[]): string[] {
  const excluded = new Set(ignoredTags.map((tag) => tag.toLowerCase()));
  const merged = new Set(existingTags);

  for (const tag of fetchedTags) {
    const hasValidLength = tag.length >= CONFIG.minTagLength && tag.length <= CONFIG.maxTagLength;

    if (hasValidLength && !excluded.has(tag.toLowerCase())) {
      merged.add(tag);
    }
  }

  return [...merged].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function main(): Promise<void> {
  console.log(chalk.bgCyan('# Fetching tags'));

  if (!CONFIG.apiUrl) {
    console.error(chalk.red('✗ TAGS_API_URL is not set in .env'));
    process.exit(1);
  }

  if (!process.env.TAGS_API_KEY) {
    console.error(chalk.red('✗ TAGS_API_KEY is not set in .env'));
    process.exit(1);
  }

  if (!CONFIG.apiOrigin) {
    console.error(chalk.red('✗ TAGS_API_ORIGIN is not set in .env.local'));
    process.exit(1);
  }

  const existingTags: string[] = JSON.parse(fs.readFileSync(CONFIG.tagsFile, 'utf-8'));
  const ignoredTags: string[] = JSON.parse(fs.readFileSync(CONFIG.ignoredTagsFile, 'utf-8'));
  const fetchedTags = await fetchTags();
  const mergedTags = mergeTags(existingTags, fetchedTags, ignoredTags);

  fs.writeFileSync(CONFIG.tagsFile, `${JSON.stringify(mergedTags, null, 2)}\n`);

  const added = mergedTags.length - existingTags.length;

  console.log(chalk.green(`✓ Fetched ${fetchedTags.length} tag(s), added ${added} new tag(s)`));
  console.log(chalk.bgCyan(`✓ ${CONFIG.tagsFile} now has ${mergedTags.length} tag(s)`));
}

main().catch((error: Error) => {
  console.error(chalk.red(`✗ ${error.message}`));
  process.exit(1);
});
