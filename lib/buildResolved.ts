// ======================================================================
// BUILD RESOLVED
// ======================================================================
//
// Stateless. Reads data/3-tags-curated.json (see lib/curatedTags.ts) and writes CONFIG.outputFile
// (data/4-tags-resolved.json) - the flat, deployed lookup the app uses at runtime (see spec.md §3.1):
//   { [slug]: canonicalSlug }
// A single flat map from every known slug (canonical, alias, or related) to its canonical slug - a
// canonical slug maps to itself. Resolving a tag is one lookup: `resolved[slugifyTagName(tag)] ?? FALLBACK`.
// This deliberately does NOT distinguish canonical/alias/related at runtime (the app never needs to know
// which one a slug was, only what image to show) - that distinction only matters for editing, and lives in
// 3-tags-curated.json's structure instead (see spec.md §3.2). "aliases" here covers both an entry's
// `aliases` and `related` slugs - both resolve identically at runtime.
//
// Until the app is updated to read 4-tags-resolved.json, this also COPIES each canonical tag's image to
// every one of its alias/related slugs (e.g. rock.jpg -> rok.jpg), so aliases resolve correctly under the
// app's current slugifyTagName-only lookup. Existing identical copies are left alone; a copy is only
// (re)written if missing or different from the canonical image.
//
// Also prints three reports, informational only - nothing here is ever auto-deleted:
//   - canonical slugs with no image yet (this is tagImageGenerator.ts's input)
//   - images whose slug is junk, or an alias/related slug (the canonical image is the "real" one; these
//     are candidates for deletion once the app no longer needs the copies, but that's a manual decision)
//   - curated slugs (canonical/alias/related/junk) that no longer appear in data/2-candidates.json (the API
//     may have stopped returning that raw tag - informational only, curated entries are never auto-pruned)
//
// Usage: npm run tags:build

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

import { type CanonicalEntry, loadCurated } from './curatedTags.ts';

// ======================================================================
// CONFIG
// ======================================================================

const CONFIG = {
  curatedFile: './data/3-tags-curated.json',
  candidatesFile: './data/2-candidates.json',
  outputFile: './data/4-tags-resolved.json',
  imageDir: './assets/tags/community',
};

// ======================================================================
// MAIN
// ======================================================================

function main(): void {
  console.log(chalk.bgCyan('# Building resolved tags'));

  const curated = loadCurated(CONFIG.curatedFile);
  const candidates: Record<string, unknown> = JSON.parse(fs.readFileSync(CONFIG.candidatesFile, 'utf-8'));

  const canonical = Object.keys(curated.canonical);
  const aliases: Record<string, string> = {};

  for (const [canonicalSlug, entry] of Object.entries(curated.canonical) as [string, CanonicalEntry][]) {
    for (const alias of [...entry.aliases, ...entry.related]) {
      aliases[alias] = canonicalSlug;
    }
  }

  const resolved: Record<string, string> = {};

  for (const slug of canonical) {
    resolved[slug] = slug;
  }

  for (const [aliasSlug, canonicalSlug] of Object.entries(aliases)) {
    resolved[aliasSlug] = canonicalSlug;
  }

  const sortedResolved = Object.fromEntries(
    Object.entries(resolved).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  );

  fs.writeFileSync(CONFIG.outputFile, `${JSON.stringify(sortedResolved, null, 2)}\n`);
  console.log(
    chalk.green(`✓ ${CONFIG.outputFile}: ${canonical.length} canonical, ${Object.keys(aliases).length} alias(es)`)
  );

  // ----------------------------------------------------------------------
  // Copy canonical images to alias/related slugs
  // ----------------------------------------------------------------------

  let copied = 0;
  let missingSource = 0;

  for (const [aliasSlug, canonicalSlug] of Object.entries(aliases)) {
    const sourcePath = path.join(CONFIG.imageDir, `${canonicalSlug}.jpg`);
    const targetPath = path.join(CONFIG.imageDir, `${aliasSlug}.jpg`);

    if (!fs.existsSync(sourcePath)) {
      missingSource += 1;
      continue;
    }

    if (fs.existsSync(targetPath) && filesAreIdentical(sourcePath, targetPath)) {
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  console.log(
    chalk.green(
      `✓ Copied ${copied} alias image(s)${missingSource > 0 ? ` (${missingSource} canonical image(s) missing, skipped)` : ''}`
    )
  );

  // ----------------------------------------------------------------------
  // Reports
  // ----------------------------------------------------------------------

  const existingImages = new Set(
    fs
      .readdirSync(CONFIG.imageDir)
      .filter((file) => file.endsWith('.jpg'))
      .map((file) => file.slice(0, -'.jpg'.length))
  );

  const missingImages = canonical.filter((slug) => !existingImages.has(slug));
  console.log(chalk.cyan(`\n! ${missingImages.length} canonical slug(s) have no image (tags:generate input):`));
  missingImages.forEach((slug) => console.log(chalk.dim(`  ${slug}`)));

  const deletionCandidates = [...existingImages].filter((slug) => curated.junk.includes(slug) || slug in aliases);
  console.log(chalk.cyan(`\n! ${deletionCandidates.length} image(s) are junk/alias/related (never auto-deleted):`));
  deletionCandidates.forEach((slug) => console.log(chalk.dim(`  ${slug}`)));

  const allCuratedSlugs = [...canonical, ...Object.keys(aliases), ...curated.junk];
  const staleSlugs = allCuratedSlugs.filter((slug) => !(slug in candidates));
  console.log(
    chalk.cyan(`\n! ${staleSlugs.length} curated slug(s) no longer appear in 2-candidates.json (informational):`)
  );
  staleSlugs.forEach((slug) => console.log(chalk.dim(`  ${slug}`)));
}

function filesAreIdentical(a: string, b: string): boolean {
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

main();
