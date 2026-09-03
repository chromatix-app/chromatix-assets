// ======================================================================
// TRIAGE TAGS
// ======================================================================
//
// Stateless. Lists the canonical tags that are NEW since the last committed data/4-tags-resolved.json -
// i.e. tags the rules could not map onto an existing image, which will therefore get their own generated
// image unless a human says otherwise. That's the one decision point in the pipeline: for each new tag,
// either accept it (do nothing - committing marks it reviewed), map it onto an existing tag's image, mark
// it junk, or - if it's a pattern - add a word to config/ so the rules catch it next time.
//
// Usage:
//   npm run tags:triage              - human-readable list to stdout
//   npm run tags:triage -- --json    - writes CONFIG.jsonOutputFile instead (gitignored, transient)
//   npm run tags:triage -- --prompt  - writes CONFIG.promptOutputFile: a self-contained prompt (the rules
//     quoted live from spec.md, the new tags, the existing canonical tags to map onto, and exact editing
//     instructions) - paste its contents into a Claude chat

import chalk from 'chalk';
import fs from 'fs';

import { loadConfig } from './config.ts';
import { loadCurated } from './curatedTags.ts';
import { type Candidates, buildResolvedMap, createResolver } from './resolveTag.ts';
import { diffResolved, loadBaseline } from './resolvedBaseline.ts';

// ======================================================================
// CONFIG
// ======================================================================

const CONFIG = {
  candidatesFile: './data/2-candidates.json',
  curatedFile: './data/3-tags-curated.json',
  resolvedFile: './data/4-tags-resolved.json',
  jsonOutputFile: './data/tags-triage.json',
  promptOutputFile: './data/curation-prompt.md',

  // The curation rules live in spec.md (single source of truth). --prompt extracts the text between these
  // two markers, which must exist verbatim in spec.md, so the prompt can never drift from the rules.
  specFile: './spec.md',
  specSectionStart: '## 4. Curation rules',
  specSectionEnd: '## 5. ',
};

// ======================================================================
// TYPES
// ======================================================================

type TriageEntry = { slug: string; name: string; variants: string[]; parts?: string[]; primary?: string };

// ======================================================================
// PROMPT
// ======================================================================

function extractCurationRules(): string {
  const spec = fs.readFileSync(CONFIG.specFile, 'utf-8');
  const startIndex = spec.indexOf(CONFIG.specSectionStart);
  const endIndex = spec.indexOf(CONFIG.specSectionEnd, startIndex + 1);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(
      `Could not find curation rules in ${CONFIG.specFile} - expected "${CONFIG.specSectionStart}" … "${CONFIG.specSectionEnd}"`
    );
  }

  return spec.slice(startIndex, endIndex).trim();
}

function buildCurationPrompt(entries: TriageEntry[], canonical: string[]): string {
  return `You are reviewing new tags for the Chromatix Assets repository (read AGENTS.md and spec.md for context).

${extractCurationRules()}

## Your task

The tags below are NEW canonical tags: the automatic rules could not map them onto an existing tag's image,
so each will get its own generated image unless you decide otherwise. For each one, pick exactly one:

- **Accept** it as its own tag: do nothing.
- **Same tag as an existing one** (typo, translation, acronym, alternative wording): add its slug to that
  existing tag's \`"aliases"\` array in \`data/3-tags-curated.json\`. Create the entry
  \`"<existing-slug>": { "aliases": [], "related": [] }\` under \`"canonical"\` if it isn't there yet.
- **A niche variant that should share an existing tag's image**: same, but in \`"related"\`.
- **Not a genre/mood/style at all** (artist, label, note, placeholder): add its slug to the top-level \`"junk"\` array.
- **A systemic pattern** (a modifier word that should always be stripped, a delimiter the splitter misses,
  an "X & Y" name that must not be split): edit the matching file in \`config/\` instead - the rules will
  then handle every current and future tag with that pattern.

The existing canonical tags you can map onto are listed at the end. Keep JSON keys/arrays sorted, don't
touch existing entries, then run \`npm run tags:build\` to validate and rebuild.

## New canonical tags (${entries.length})

\`\`\`json
${JSON.stringify(entries, null, 2)}
\`\`\`

## Existing canonical tags (${canonical.length})

${canonical.join(', ')}
`;
}

// ======================================================================
// MAIN
// ======================================================================

function main(): void {
  const asJson = process.argv.includes('--json');
  const asPrompt = process.argv.includes('--prompt');

  const config = loadConfig();
  const curated = loadCurated(CONFIG.curatedFile);
  const candidates: Candidates = JSON.parse(fs.readFileSync(CONFIG.candidatesFile, 'utf-8'));
  const resolver = createResolver(candidates, curated, config);
  const resolved = buildResolvedMap(candidates, resolver);
  const diff = diffResolved(loadBaseline(CONFIG.resolvedFile), resolved);

  const entries: TriageEntry[] = diff.addedCanonical.map((slug) => ({
    slug,
    name: resolver.displayName(slug),
    ...candidates[slug],
  }));
  const existingCanonical = Object.keys(resolved)
    .filter((slug) => resolved[slug] === slug && !diff.addedCanonical.includes(slug))
    .sort();

  if (asJson) {
    fs.writeFileSync(CONFIG.jsonOutputFile, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(chalk.bgCyan(`✓ ${CONFIG.jsonOutputFile} written with ${entries.length} new canonical tag(s)`));
    return;
  }

  if (asPrompt) {
    if (entries.length === 0) {
      console.log(chalk.bgGreen('✓ No new canonical tags - nothing to review, no prompt written'));
      return;
    }

    fs.writeFileSync(CONFIG.promptOutputFile, buildCurationPrompt(entries, existingCanonical));
    console.log(
      chalk.bgCyan(
        `✓ ${CONFIG.promptOutputFile} written with ${entries.length} new canonical tag(s) - paste its contents into a Claude chat`
      )
    );
    return;
  }

  console.log(chalk.bgCyan('# New canonical tags since last commit'));

  for (const entry of entries) {
    const flags = entry.parts ? chalk.cyan(`compound → primary "${entry.primary}"`) : '';

    console.log(`${chalk.bold(entry.slug)} ${chalk.dim(`"${entry.name}"`)} ${flags}`);
    console.log(chalk.dim(`  variants: ${entry.variants.join(', ')}`));
  }

  console.log(chalk.bgCyan(`\n✓ ${entries.length} new canonical tag(s) to review`));
}

main();
