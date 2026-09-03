// ======================================================================
// RESOLVED BASELINE
// ======================================================================
//
// "Reviewed" means "committed": the last committed data/4-tags-resolved.json is the baseline that
// tags:build and tags:triage diff a fresh resolution against to find what's new since a human last looked.
// No separate seen/state file - git is the memory. Falls back to the on-disk file if the repo has no
// committed copy yet (first run), and to an empty map if there's no file at all.

import { execSync } from 'child_process';
import fs from 'fs';

export type ResolvedMap = Record<string, string>;

/**
 * Loads the committed (HEAD) version of the resolved map, falling back to the working-tree file, then to
 * an empty map.
 * @param file - Path to the resolved map, relative to the repo root
 * @returns The baseline map
 */
export function loadBaseline(file: string): ResolvedMap {
  try {
    const committed = execSync(`git show HEAD:${JSON.stringify(file.replace(/^\.\//, ''))}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return JSON.parse(committed) as ResolvedMap;
  } catch {
    // Not committed yet (or not a git checkout) - fall through
  }

  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ResolvedMap;
  }

  return {};
}

export type ResolvedDiff = {
  // Slugs present now that weren't in the baseline at all
  added: string[];
  // Of those, the ones that resolved to themselves - i.e. new tags that will get their own image
  addedCanonical: string[];
  // Slugs whose target changed (e.g. a config change re-resolved them)
  retargeted: { slug: string; from: string; to: string }[];
  // Slugs in the baseline that are gone now (became junk, or dropped from the raw list)
  removed: string[];
};

/**
 * Diffs a freshly built resolved map against the baseline.
 * @param baseline - The committed/previous map (see loadBaseline)
 * @param current - The freshly built map
 * @returns What changed
 */
export function diffResolved(baseline: ResolvedMap, current: ResolvedMap): ResolvedDiff {
  const added = Object.keys(current).filter((slug) => !(slug in baseline));

  return {
    added,
    addedCanonical: added.filter((slug) => current[slug] === slug),
    retargeted: Object.keys(current)
      .filter((slug) => slug in baseline && baseline[slug] !== current[slug])
      .map((slug) => ({ slug, from: baseline[slug], to: current[slug] })),
    removed: Object.keys(baseline).filter((slug) => !(slug in current)),
  };
}
