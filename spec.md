# Tag Resolution — Spec

Companion to AGENTS.md. This file is the source of truth for the _design_ of tag resolution: what we're solving,
the rules, and what's deliberately deferred. AGENTS.md describes the code as it is today.

## 1. Goal

Every raw tag string a Chromatix user has (genre/mood/style, free text, thousands of independent Plex libraries)
must resolve to one thumbnail image, while the set of images we _generate and curate_ stays small and stops
growing with junk. Constraints:

- **Deterministic and future-proof**: resolution is a pure function of the tag string, the raw tag data, and the
  lists in `config/` plus the small exceptions file. It never depends on which image files happen to exist. Same
  inputs → same map, today or in a year; change a config list → every affected tag re-resolves on the next build.
- **Config, not code**: every word list (blocklist, modifiers, delimiters, protected compound names) is a JSON file
  in `config/` with its own description. Code contains rules, never lists.
- **Bounded**: a new junk/variant/modifier tag costs zero generation. Only a genuinely new canonical tag gets an
  image, and a human sees those before they're generated.
- **Judgement is data**: where a rule can't decide (typos, translations, "this niche tag should borrow that
  image", junk that isn't structurally detectable), a human/LLM records the decision once in
  `data/3-tags-curated.json`. Everything else is derived.

## 2. Facts (measured 2026-09-03 after the rules rework — re-measure, don't trust)

- `data/1-tags-raw.json`: 2,574 raw strings → `data/2-candidates.json`: 2,577 slugs, 440 compounds.
- Resolved: **1,712 canonical** (own image), 730 sharing another tag's image, 135 junk. Down from 2,066 canonical
  under the previous "everything with an image is canonical" curation.
- `data/3-tags-curated.json` (exceptions only): 97 canonical entries (name overrides, pins, alias/related
  targets), 135 junk.
- 400 canonical slugs have no image yet (`tags:generate` queue). 71 existing images are for slugs that are no
  longer canonical (orphans - report only, delete in a reviewed commit).
- The app resolves `slugifyTagName(tag)` → `<slug>.jpg` with a fallback image on load error; it does not fetch
  JSON yet. The API returns tag names only (no counts, no genre/mood/style field).

## 3. Design

### 3.1 Runtime contract (app side)

```
slug   = slugifyTagName(tag)
target = resolved[slug]          // data/4-tags-resolved.json, { [slug]: canonicalSlug }
image  = target ? `${CDN}/assets/tags/community/${target}.jpg` : FALLBACK
```

One flat map, one lookup per tag, no branching - scales to resolving hundreds of tags at once. Canonical slugs
map to themselves; junk is absent (→ fallback). Until the app reads the JSON, `tags:build` copies each canonical
image to its sharing slugs so they work under the current filename-only lookup.

### 3.2 Files

| File                        | Role                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `config/blocklist.json`     | Config. Structurally-valid strings that are never a tag ("Misc", "Test").    |
| `config/delimiters.json`    | Config. Separators and whitespace-bounded connectors that split a multi-tag. |
| `config/compound-tags.json` | Config. "X & Y" names that must not be split ("drum & bass").                |
| `config/modifiers.json`     | Config. Prefix/suffix words stripped to find the tag whose image to share.   |
| `data/1-tags-raw.json`      | Input. Every raw string the API has ever returned. Append-only.              |
| `data/2-candidates.json`    | Derived. Valid tags by slug, compounds split into parts with a primary.      |
| `data/3-tags-curated.json`  | **Durable, hand-edited.** Exceptions only - see §4.                          |
| `data/4-tags-resolved.json` | Derived, deployed. The flat map above. Committing it = "reviewed".           |

### 3.3 Resolution rules (`lib/resolveTag.ts`), first match wins

1. **Exceptions** (`3-tags-curated.json`): junk → no image; explicit alias/related → that tag's image; a
   canonical key → pinned as its own image (overrides every rule below - this is how "german-folk is its own
   thing" is expressed if a modifier would otherwise strip it) and may carry a display-name override.
2. **Hyphenation**: slugs identical once hyphens are removed are one tag. The representative is a pinned member if
   there is one, else the fewest-hyphen spelling (stable; which spelling holds the file is invisible to the app).
3. **Modifiers** (`config/modifiers.json`): strip a listed prefix from the start or suffix from the end, repeatedly,
   while the remainder is a known tag; the tag then shares the remainder's image (`classic-rock` → `rock`,
   `acoustic-music` → `acoustic`). Only listed words are ever stripped - `death-metal` stays `death-metal`.
4. **Compound** (`2-candidates.json` parts): a tag that split into several shares its primary part's image
   (`lib/selectPrimaryTag.ts`: first part not led by a modifier); a junk part is skipped; all-junk → junk.
5. Otherwise **canonical**: its own image.

Every rule that points at another slug resolves that slug recursively, so chains and overrides compose.

### 3.4 Scripts

| Script                   | Reads                               | Writes                                                        |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------- |
| `tags:fetch`             | API                                 | `1-tags-raw.json` (append)                                    |
| `tags:candidates`        | raw, config                         | `2-candidates.json`                                           |
| `tags:build`             | candidates, curated, config, images | `4-tags-resolved.json`, shared image copies, reports, verdict |
| `tags:update`            | —                                   | fetch → candidates → build                                    |
| `tags:triage [--prompt]` | same as build + git HEAD            | stdout, or `data/curation-prompt.md`                          |
| `tags:generate`          | resolved, candidates, curated       | images for canonical slugs without one                        |

"New" means "not in the last **committed** `4-tags-resolved.json`" (`lib/resolvedBaseline.ts`) - git is the
memory, there is no seen-file. `tags:build` ends with a verdict: nothing to review, or the exact next commands.

## 4. Curation rules (what a human/LLM decides, and how to record it)

The rules above resolve everything automatically. A human only looks at **new canonical tags** - tags the rules
could not map onto an existing image, which will therefore get their own generated image. For each one:

1. **Accept** it as a real, distinct genre/mood/style → do nothing. Committing marks it reviewed.
2. **It is the same tag as an existing one** (typo `electrionic`, translation `klassik`, acronym `dnb`, alternative
   wording) → add its slug to that tag's `"aliases"` in `data/3-tags-curated.json`.
3. **It is a niche variant that should share an existing tag's image** (`kaballah-doom` → `doom-metal`) → add it to
   that tag's `"related"`. Same runtime effect as an alias; kept separate so editorial calls can be revisited.
4. **It is not a genre/mood/style** (artist, label, personal note, placeholder) → add it to `"junk"`.
5. **It is a pattern**, not a one-off → fix the config instead, so every current and future tag with that pattern
   is handled: a word that should always be stripped → `config/modifiers.json`; a join the splitter missed →
   `config/delimiters.json`; an "X & Y" name being wrongly split → `config/compound-tags.json`; a placeholder
   string → `config/blocklist.json`.
6. **A rule got it wrong** (a modifier stripped something that is its own genre) → add the slug as a canonical key
   in `3-tags-curated.json` to pin it; add `"name"` there too if the derived display name is poor.

Do not merge distinct genres because they're similar (`deep-house` ≠ `tech-house`). Nationality/region words
(`german-folk`, `texas-blues`) and texture words (`acoustic-`, `atmospheric-`) are deliberately NOT modifiers -
they usually name a distinct style; add one to `config/modifiers.json` only if you want every such tag collapsed.

## 5. Status

Built and verified 2026-09-03: config directory, pure resolver with tests, config-driven splitter, git-baseline
review verdict in `tags:build`, exceptions-only curated file (migrated from the previous full curation). Remaining,
all operational: commit `data/4-tags-resolved.json` to establish the review baseline; run `tags:generate` for the
400 canonical slugs without images; switch the app to the §3.1 lookup (separate repo), after which the shared
image copies and the 71 orphan images can be deleted in a reviewed commit.

## 6. Deferred / not doing

- Fuzzy/Levenshtein suggestions in triage — only if the review list after a fetch ever gets painful.
- Machine translation — the LLM review handles the occasional foreign tag; `delimiters.json` already splits
  foreign connectors (`y`, `et`, `und`, `e`).
- Frequency threshold — needs API counts.
- Genre/mood/style separation — needs the API field.
- Automatic image deletion — reports only; deletion stays a reviewed commit.
