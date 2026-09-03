// ======================================================================
// CONFIG
// ======================================================================
//
// Loads every hand-maintained list the tag pipeline depends on from config/*.json. Nothing in lib/ should
// hard-code a word list - if a rule needs one, it lives here, so that changing behaviour never means
// editing code. Each config file carries its own "description" explaining what belongs in it.

import fs from 'fs';
import path from 'path';

const CONFIG_DIR = './config';

export type PipelineConfig = {
  blocklist: string[];
  modifiers: { prefix: string[]; suffix: string[] };
  delimiters: { separators: string[]; connectors: string[]; distributiveHeads: string[] };
  compoundTags: string[];
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf-8')) as T;
}

function assertStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${where} must be an array of strings`);
  }

  return value;
}

/**
 * Reads and validates the pipeline's config files (config/blocklist.json, modifiers.json,
 * delimiters.json, compound-tags.json). Throws with the offending file/field if any list is malformed.
 * @returns The validated config
 */
export function loadConfig(): PipelineConfig {
  const blocklist = readJson<{ tags: unknown }>('blocklist.json');
  const modifiers = readJson<{ prefix: unknown; suffix: unknown }>('modifiers.json');
  const delimiters = readJson<{ separators: unknown; connectors: unknown; distributiveHeads: unknown }>(
    'delimiters.json'
  );
  const compoundTags = readJson<{ tags: unknown }>('compound-tags.json');

  return {
    blocklist: assertStringArray(blocklist.tags, 'config/blocklist.json "tags"'),
    modifiers: {
      prefix: assertStringArray(modifiers.prefix, 'config/modifiers.json "prefix"'),
      suffix: assertStringArray(modifiers.suffix, 'config/modifiers.json "suffix"'),
    },
    delimiters: {
      separators: assertStringArray(delimiters.separators, 'config/delimiters.json "separators"'),
      connectors: assertStringArray(delimiters.connectors, 'config/delimiters.json "connectors"'),
      distributiveHeads: assertStringArray(delimiters.distributiveHeads, 'config/delimiters.json "distributiveHeads"'),
    },
    compoundTags: assertStringArray(compoundTags.tags, 'config/compound-tags.json "tags"'),
  };
}
