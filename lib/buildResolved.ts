// ======================================================================
// BUILD RESOLVED
// ======================================================================
//
// Stateless. Resolves every candidate slug (lib/resolveTag.ts) using data/2-candidates.json, the
// exceptions in data/3-tags-curated.json and the lists in config/, and writes CONFIG.outputFile
// (data/4-tags-resolved.json) - the flat, deployed lookup the app uses at runtime:
//   { [slug]: canonicalSlug }
// Every non-junk slug maps to the canonical slug whose image it shows; canonical slugs map to themselves.
// Resolving a tag in the app is one lookup: `resolved[slugifyTagName(tag)] ?? FALLBACK`.
//
// Image files are never an INPUT to resolution - the map is a pure function of data + config, so it's
// consistent over time. Images are only a downstream concern, reported here:
//   - canonical slugs with no image yet (tags:generate's queue)
//   - images whose slug is not canonical (junk/alias/related, or no longer a tag at all) - orphans that
//     can be deleted in a reviewed commit; never deleted automatically
//   - curated exceptions that point at unknown slugs
//
// Until the app reads 4-tags-resolved.json directly, this also COPIES each canonical image to its
// alias/related slugs (rock.jpg -> rok.jpg) so those tags work under the app's current
// slugifyTagName-only lookup. Identical existing copies are left alone.
//
// Finally, the map is diffed against the last COMMITTED map (lib/resolvedBaseline.ts) and a verdict is
// printed: either nothing new needs a decision, or the exact next command to review new canonical tags
// before they get images.
//
// Usage: npm run tags:build

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

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
  outputFile: './data/4-tags-resolved.json',
  imageDir: './assets/tags/community',

  // How many slugs to list per report before truncating with a count
  reportLimit: 40,
};

// ======================================================================
// MAIN
// ======================================================================

function listReport(title: string, slugs: string[], colour: (s: string) => string = chalk.cyan): void {
  console.log(colour(`\n! ${slugs.length} ${title}`));
  slugs.slice(0, CONFIG.reportLimit).forEach((slug) => console.log(chalk.dim(`  ${slug}`)));

  if (slugs.length > CONFIG.reportLimit) {
    console.log(chalk.dim(`  … and ${slugs.length - CONFIG.reportLimit} more`));
  }
}

function main(): void {
  console.log(chalk.bgCyan('# Building resolved tags'));

  const config = loadConfig();
  const curated = loadCurated(CONFIG.curatedFile);
  const candidates: Candidates = JSON.parse(fs.readFileSync(CONFIG.candidatesFile, 'utf-8'));
  const resolver = createResolver(candidates, curated, config);

  const baseline = loadBaseline(CONFIG.outputFile);
  const resolved = buildResolvedMap(candidates, resolver);

  fs.writeFileSync(CONFIG.outputFile, `${JSON.stringify(resolved, null, 2)}\n`);

  const canonical = Object.keys(resolved).filter((slug) => resolved[slug] === slug);
  const nonCanonical = Object.keys(resolved).filter((slug) => resolved[slug] !== slug);
  const junkCount = Object.keys(candidates).length - Object.keys(resolved).length;

  console.log(
    chalk.green(
      `✓ ${CONFIG.outputFile}: ${canonical.length} canonical, ${nonCanonical.length} sharing an image, ${junkCount} junk`
    )
  );

  // ----------------------------------------------------------------------
  // Exceptions sanity: targets that resolve nowhere
  // ----------------------------------------------------------------------

  const unknownTargets: string[] = [];

  for (const [slug, entry] of Object.entries(curated.canonical)) {
    for (const mapped of [...entry.aliases, ...entry.related]) {
      if (!(mapped in candidates)) {
        unknownTargets.push(`${mapped} (alias/related of ${slug}, not in candidates)`);
      }
    }

    if (!(slug in candidates)) {
      unknownTargets.push(`${slug} (canonical, not in candidates)`);
    }
  }

  if (unknownTargets.length > 0) {
    listReport('curated slug(s) not present in 2-candidates.json (stale exceptions?):', unknownTargets, chalk.yellow);
  }

  // ----------------------------------------------------------------------
  // Copy canonical images to alias/related slugs
  // ----------------------------------------------------------------------

  let copied = 0;
  let missingSource = 0;

  for (const slug of nonCanonical) {
    const sourcePath = path.join(CONFIG.imageDir, `${resolved[slug]}.jpg`);
    const targetPath = path.join(CONFIG.imageDir, `${slug}.jpg`);

    if (!fs.existsSync(sourcePath)) {
      missingSource += 1;
      continue;
    }

    if (fs.existsSync(targetPath) && fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath))) {
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  console.log(
    chalk.green(
      `✓ Copied ${copied} shared image(s)${missingSource > 0 ? ` (${missingSource} skipped - canonical image missing)` : ''}`
    )
  );

  // ----------------------------------------------------------------------
  // Image reports (informational - nothing is deleted)
  // ----------------------------------------------------------------------

  const existingImages = new Set(
    fs
      .readdirSync(CONFIG.imageDir)
      .filter((file) => file.endsWith('.jpg'))
      .map((file) => file.slice(0, -'.jpg'.length))
  );
  const canonicalSet = new Set(canonical);
  const nonCanonicalSet = new Set(nonCanonical);

  listReport(
    'canonical slug(s) have no image yet (tags:generate queue)',
    canonical.filter((slug) => !existingImages.has(slug))
  );
  listReport(
    'image(s) are not for a canonical slug - shared copies, junk, or no longer a tag (delete in a reviewed commit if wanted)',
    [...existingImages].filter((slug) => !canonicalSet.has(slug) && !nonCanonicalSet.has(slug)).sort()
  );

  // ----------------------------------------------------------------------
  // Verdict: what changed since the last committed map, and what to do next
  // ----------------------------------------------------------------------

  const diff = diffResolved(baseline, resolved);

  console.log(chalk.bgCyan('\n# Since last commit'));
  console.log(
    chalk.dim(
      `  ${diff.added.length} new slug(s), ${diff.retargeted.length} re-resolved, ${diff.removed.length} removed`
    )
  );

  if (diff.retargeted.length > 0) {
    listReport(
      'slug(s) now point at a different image (config/exception change):',
      diff.retargeted.map((r) => `${r.slug}: ${r.from} -> ${r.to}`)
    );
  }

  if (diff.addedCanonical.length === 0) {
    console.log(chalk.bgGreen('\n✓ No new canonical tags - nothing to review'));
    return;
  }

  listReport(
    'new canonical tag(s) will get their own image - review before running tags:generate:',
    diff.addedCanonical,
    chalk.yellow
  );
  console.log(chalk.bgYellow('\n→ Next step: review these with AI'));
  console.log('  1. npm run tags:triage -- --prompt');
  console.log(
    '  2. Paste the contents of data/curation-prompt.md into a Claude chat and let it edit data/3-tags-curated.json'
  );
  console.log('  3. npm run tags:build   (then commit - committing is what marks them reviewed)');
}

main();
