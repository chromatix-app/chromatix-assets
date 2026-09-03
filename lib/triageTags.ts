// ======================================================================
// TRIAGE TAGS
// ======================================================================
//
// Stateless. Reads CONFIG.candidatesFile and CONFIG.curatedFile, and prints every candidate slug not yet
// present anywhere in the curated data (not a canonical key, alias, related tag, or junk entry) - the
// review queue for the curation pass described in spec.md §4.
//
// "Already decided" == "present in curated" - there is no separate seen/state file. Once a slug is added
// to data/3-tags-curated.json (in any of its four places), it stops appearing here.
//
// Usage:
//   npm run tags:triage              - human-readable list to stdout
//   npm run tags:triage -- --json    - writes CONFIG.jsonOutputFile instead, for batch curation
//   npm run tags:triage -- --prompt  - writes CONFIG.promptOutputFile: a single self-contained prompt
//     (curation rules extracted from spec.md §4, the undecided candidates, and exact output instructions)
//     - paste its contents into a Claude chat to get back an updated data/3-tags-curated.json

import chalk from 'chalk';
import fs from 'fs';

import { type CanonicalEntry, loadCurated } from './curatedTags.ts';

// ======================================================================
// CONFIG
// ======================================================================

const CONFIG = {
  candidatesFile: './data/2-candidates.json',
  curatedFile: './data/3-tags-curated.json',
  jsonOutputFile: './data/tags-triage.json',
  promptOutputFile: './data/curation-prompt.md',

  // Curation rules are kept in spec.md (the single source of truth for them - see spec.md §4) rather than
  // duplicated here. --prompt mode extracts the text between these two markers, which must exist verbatim
  // as their own lines in spec.md, so the two can never silently drift apart.
  specFile: './spec.md',
  specSectionStart: '## 4. Curation rules',
  specSectionEnd: '## 5. Task list',
};

// ======================================================================
// TYPES
// ======================================================================

type CandidateEntry = { variants: string[]; parts?: string[]; primary?: string };
type TriageEntry = { slug: string; hasImage: boolean } & CandidateEntry;

// ======================================================================
// MAIN
// ======================================================================

// Extracts the curation rules from spec.md, from CONFIG.specSectionStart up to (not including)
// CONFIG.specSectionEnd, so --prompt mode always quotes the current rules rather than a copy that can
// drift out of sync. Throws if either marker isn't found, rather than silently omitting the rules.
function extractCurationRules(): string {
  const spec = fs.readFileSync(CONFIG.specFile, 'utf-8');
  const startIndex = spec.indexOf(CONFIG.specSectionStart);
  const endIndex = spec.indexOf(CONFIG.specSectionEnd);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(
      `Could not find curation rules in ${CONFIG.specFile} - expected "${CONFIG.specSectionStart}" ... "${CONFIG.specSectionEnd}"`
    );
  }

  return spec.slice(startIndex, endIndex).trim();
}

function buildCurationPrompt(undecided: TriageEntry[]): string {
  const rules = extractCurationRules();

  return `You are curating tags for the Chromatix Assets repository. Read AGENTS.md and spec.md in this repo
for full context if you need it, but the rules you need are quoted below.

${rules}

## Your task

Below is the current list of undecided candidate slugs (from \`npm run tags:triage -- --json\`), each with
its raw variant string(s), and whether it's a compound (\`parts\`/\`primary\`) or already has a generated
image (\`hasImage\`).

Apply the curation rules above to classify **every** slug below into exactly one of: \`canonical\`, an
\`aliases\` entry of a canonical tag, a \`related\` entry of a canonical tag, or \`junk\`.

Then edit \`data/3-tags-curated.json\` directly to add your decisions:
- New canonical tag: add a key under \`"canonical"\`, e.g. \`"some-slug": { "name": "Some Slug", "aliases": [], "related": [] }\`.
- Alias/related of an EXISTING canonical tag: append the slug to that entry's \`"aliases"\` or \`"related"\` array.
- Alias/related of a canonical tag you're ALSO adding in this same batch: still just append it to that new
  entry's array - don't create a separate entry for it.
- Junk: append the slug (just the string) to the top-level \`"junk"\` array.

Every slug below must end up in exactly one of those places - none should be left undecided. Keep both
arrays/objects sorted alphabetically by key/value, matching the existing file's style. Do not touch any
existing entries. When you're done, run \`npm run tags:build\` to verify the file is still valid (it throws
on any slug appearing in more than one place) and to regenerate \`data/4-tags-resolved.json\`.

## Undecided candidates (${undecided.length})

\`\`\`json
${JSON.stringify(undecided, null, 2)}
\`\`\`
`;
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const asPrompt = process.argv.includes('--prompt');

  if (!asJson && !asPrompt) {
    console.log(chalk.bgCyan('# Triaging candidates'));
  }

  const candidates: Record<string, CandidateEntry> = JSON.parse(fs.readFileSync(CONFIG.candidatesFile, 'utf-8'));
  const curated = loadCurated(CONFIG.curatedFile);

  const decided = new Set<string>();

  for (const [slug, entry] of Object.entries(curated.canonical) as [string, CanonicalEntry][]) {
    decided.add(slug);
    entry.aliases.forEach((s) => decided.add(s));
    entry.related.forEach((s) => decided.add(s));
  }

  curated.junk.forEach((s) => decided.add(s));

  const imageDir = './assets/tags/community';
  const existingImages = new Set(
    fs
      .readdirSync(imageDir)
      .filter((file) => file.endsWith('.jpg'))
      .map((file) => file.slice(0, -'.jpg'.length))
  );

  const undecided: TriageEntry[] = Object.entries(candidates)
    .filter(([slug]) => !decided.has(slug))
    .map(([slug, entry]) => ({ slug, hasImage: existingImages.has(slug), ...entry }))
    .sort((a, b) => a.slug.localeCompare(b.slug, undefined, { sensitivity: 'base' }));

  if (asJson) {
    fs.writeFileSync(CONFIG.jsonOutputFile, `${JSON.stringify(undecided, null, 2)}\n`);
    console.log(chalk.bgCyan(`✓ ${CONFIG.jsonOutputFile} written with ${undecided.length} undecided slug(s)`));
    return;
  }

  if (asPrompt) {
    if (undecided.length === 0) {
      console.log(chalk.bgCyan('✓ Nothing undecided - no prompt needed'));
      return;
    }

    fs.writeFileSync(CONFIG.promptOutputFile, buildCurationPrompt(undecided));
    console.log(
      chalk.bgCyan(
        `✓ ${CONFIG.promptOutputFile} written with ${undecided.length} undecided slug(s) - paste its contents into a Claude chat`
      )
    );
    return;
  }

  for (const entry of undecided) {
    const flags = [
      entry.hasImage ? chalk.dim('has-image') : chalk.yellow('no-image'),
      entry.parts ? chalk.cyan(`compound → primary "${entry.primary}"`) : null,
    ].filter(Boolean);

    console.log(`${chalk.bold(entry.slug)} ${flags.join(' ')}`);
    console.log(chalk.dim(`  variants: ${entry.variants.join(', ')}`));

    if (entry.parts) {
      console.log(chalk.dim(`  parts: ${entry.parts.join(', ')}`));
    }
  }

  console.log(
    chalk.bgCyan(`\n✓ ${undecided.length} undecided candidate(s) of ${Object.keys(candidates).length} total`)
  );
}

main();
