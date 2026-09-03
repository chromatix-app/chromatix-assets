# Agent Instructions

## Project Overview

`chromatix-assets` is an image asset repository for Chromatix, holding thumbnail images for community tags (genres,
moods, styles). It's a standalone Node/TypeScript project with its own `package.json` and dependencies.

Images can be added to `assets/tags/community/` by hand. The project also includes a tag resolution pipeline that
turns the Chromatix API's raw (large, messy) tag list into a bounded set of canonical tags, each with one image,
plus a flat lookup the app uses to find the image for any tag string (see
[Tag Resolution](#tag-resolution) below), and `lib/tagImageGenerator.ts`, which generates thumbnails via the
Gemini API (see [Tag Image Generation](#tag-image-generation)).

`spec.md` is the design document: the goal and constraints, the resolution rules, the curation rules, and what's
deliberately deferred. This file documents how the code works today. Keep both current.

## Tech Stack

- **Node.js 24+** — runs `.ts` files directly via native TypeScript type stripping; no build step
- **TypeScript** — all scripts are `.ts`
- **@google/genai** — Gemini API client, used with the `gemini-2.5-flash-image` model
- **sharp** — resizes/crops generated images to the target output dimensions
- **chalk** — console log styling
- **dotenv** — loads `GEMINI_API_KEY` from `.env` / `.env.local`

## Project Structure

```
config/                    # EVERY word list lives here, never in code. Each file has a "description".
  blocklist.json           # Strings dropped before anything else ("Misc", "Test") - compared by slug
  delimiters.json          # Separators and whitespace-bounded connectors that split a multi-tag string
  compound-tags.json       # "X & Y" names that must NOT be split ("drum & bass", "rock & roll")
  modifiers.json           # Prefix/suffix words stripped to find the tag whose image to share
data/
  1-tags-raw.json          # INPUT. Every tag the API has ever returned. Raw, unfiltered, append-only.
  2-candidates.json        # DERIVED. Valid tags by slug; multi-tag strings split into parts + primary.
  3-tags-curated.json      # DURABLE, hand-edited. EXCEPTIONS ONLY - what the rules can't derive.
  4-tags-resolved.json     # DERIVED, DEPLOYED. Flat { [slug]: canonicalSlug } map. Committing = reviewed.
  tags-triage.json         # transient, gitignored (tags:triage --json)
  curation-prompt.md       # transient, gitignored (tags:triage --prompt)
references/tags/community/ # Reference image tiers for the generator (see Tag Image Generation)
assets/tags/community/     # <slug>.jpg - one per canonical tag, plus a copy per sharing slug (see tags:build)
lib/
  config.ts                # loadConfig() - reads and validates config/*.json
  resolveTag.ts            # THE resolution rules: createResolver(), buildResolvedMap()
  resolveTag.test.ts
  curatedTags.ts           # loadCurated()/validateCurated() for 3-tags-curated.json
  curatedTags.test.ts
  resolvedBaseline.ts      # loadBaseline() (committed 4-tags-resolved.json via git) + diffResolved()
  isValidTag.ts            # Structural validity of a raw string (+ test)
  splitMultiTag.ts         # Splits a raw string using config delimiters/protected phrases (+ test)
  selectPrimaryTag.ts      # Picks a compound's primary part, skipping modifier-led parts (+ test)
  slugifyTagName.ts        # Tag name -> slug (+ test). Shared contract with the app.
  tagFetcher.ts            # tags:fetch
  buildCandidates.ts       # tags:candidates
  buildResolved.ts         # tags:build
  triageTags.ts            # tags:triage
  tagImageGenerator.ts     # tags:generate
```

## Tag Resolution

Resolution is a **pure function of data + config**: for any slug, the image it shows depends only on
`2-candidates.json`, `3-tags-curated.json` and `config/*.json` - never on which image files exist. Same inputs
give the same `4-tags-resolved.json`; editing a config list re-resolves every affected tag on the next build.

**Rules** (`lib/resolveTag.ts`, first match wins): exceptions (junk / alias / related / pinned canonical) →
hyphenation (`bossanova` ≡ `bossa-nova`; a pinned spelling wins, else fewest hyphens) → modifiers (strip a
`config/modifiers.json` prefix/suffix while the remainder is a known tag: `classic-rock` shares `rock`'s image)
→ compound (a split tag shares its primary part's image) → canonical (its own image). Rules that point at another
slug resolve it recursively. Full detail and rationale in `spec.md` §3.3; what a human decides in `spec.md` §4.

**Only `data/3-tags-curated.json` is hand-edited**, and it holds exceptions only:

```json
{
  "canonical": {
    "hip-hop": { "name": "Hip-Hop", "aliases": [], "related": [] },
    "r-and-b": { "name": "R&B", "aliases": ["rnb", "rhythm-and-blues"], "related": [] },
    "doom-metal": { "aliases": [], "related": ["kaballah-doom"] }
  },
  "junk": ["tyler-the-creator", "matador-records"]
}
```

A canonical key **pins** that slug as its own image (overriding hyphenation/modifier rules) and may set a display
`name`; `aliases`/`related` map slugs onto that tag's image; `junk` removes a slug. A slug may appear in at most
one place (validated on load). Everything the rules derive on their own is deliberately absent from this file.

### Scripts

- **`npm run tags:fetch`** (`lib/tagFetcher.ts`) — Fetches from the Chromatix API (`TAGS_API_URL`, `X-Api-Key`
  from `TAGS_API_KEY`, required `Origin` from `TAGS_API_ORIGIN`) and merges into `data/1-tags-raw.json`,
  alphabetised, exact-string dedup, **no filtering**. Only ever adds.
- **`npm run tags:candidates`** (`lib/buildCandidates.ts`) — Stateless. Drops raw strings that fail `isValidTag`
  or slugify to a `config/blocklist.json` entry; splits multi-tag strings with `splitMultiTag` (separators and
  connectors from `config/delimiters.json`, phrases in `config/compound-tags.json` protected); re-validates each
  part; groups by `slugifyTagName` into `data/2-candidates.json` as
  `{ [slug]: { variants, parts?, primary? } }`, with `primary` from `selectPrimaryTag` (first part not led by a
  `modifiers.json` prefix).
- **`npm run tags:build`** (`lib/buildResolved.ts`) — Stateless. Resolves every candidate and writes
  `data/4-tags-resolved.json`. Also copies each canonical image to the slugs that share it (so aliases work under
  the app's current filename-only lookup - load-bearing until the app reads the JSON), prints reports (canonical
  slugs without an image = the generate queue; images that are no longer for a canonical slug = orphans, never
  auto-deleted; stale exceptions), then diffs against the last **committed** map and prints a verdict: either
  `No new canonical tags - nothing to review`, or the list of new canonical tags plus the exact next commands.
- **`npm run tags:update`** — `tags:fetch` → `tags:candidates` → `tags:build`. The routine command; image
  generation is deliberately separate.
- **`npm run tags:triage`** (`lib/triageTags.ts`) — Lists the new canonical tags since the last committed map.
  `-- --json` writes `data/tags-triage.json`; `-- --prompt` writes `data/curation-prompt.md`, a self-contained
  prompt (rules quoted live from `spec.md` §4, the new tags with variants, the existing canonical tags to map onto,
  exact editing instructions) to paste into a Claude chat.
- **`npm run tags:generate`** (`lib/tagImageGenerator.ts`) — see [Tag Image Generation](#tag-image-generation).

### Routine workflow

1. `npm run tags:update`. If it ends with "nothing to review", go to 3.
2. `npm run tags:triage -- --prompt`, paste `data/curation-prompt.md` into a Claude chat; it edits
   `data/3-tags-curated.json` (or a `config/` list for a systemic pattern). Then `npm run tags:build` again.
3. Commit — committing `data/4-tags-resolved.json` is what marks its tags reviewed.
4. `npm run tags:generate` whenever you want images for the queue.

"New" is computed against `git show HEAD:data/4-tags-resolved.json` (`lib/resolvedBaseline.ts`), falling back to
the on-disk file if nothing is committed yet. There is no seen-state file to maintain.

### Runtime resolution (app side)

The app today resolves `slugifyTagName(tag)` → `<slug>.jpg` with a fallback image on load error. The intended
contract is one lookup in the deployed map: `resolved[slugifyTagName(tag)] ?? FALLBACK`. Until the app switches,
`tags:build`'s image copies make sharing slugs work; afterwards the copies and orphan images can be deleted in a
reviewed commit. `slugifyTagName` must stay byte-identical between this repo and the app.

## Tag Image Generation

`lib/tagImageGenerator.ts` reads `data/4-tags-resolved.json`, takes every slug that maps to itself (canonical)
and has no `assets/tags/community/<slug>.jpg` yet, and generates one via the Gemini API using the tag's display
name (`resolver.displayName`: curated `name` override, else the best-cased raw variant) in `CONFIG.prompt`, plus
reference images to steer style. Output is cropped/resized to `CONFIG.width` x `CONFIG.height` with `sharp`.
Already-generated slugs are skipped, so re-running is safe. Slugs that share another tag's image are never
generated.

**All tunables live in the `CONFIG` object at the top of the file** — model, prompt, dimensions, paths, reference
tiers, temperature, request delay, max generations per run, `startTag` (a canonical slug to resume from).

Each request gets a random `seed`; combined with `CONFIG.temperature`, deleting an image and re-running produces a
genuinely different result.

### Why the reference-tier retry logic exists

Gemini's image model (`gemini-2.5-flash-image`) can fail a request with `finishReason: "IMAGE_OTHER"` and no other
diagnostic. Confirmed via isolated testing during development: it is not a content-safety block (the same tag
generates fine bare), not a rate limit (that surfaces as HTTP 429), and is correlated with overall request size —
long prompt + many reference images + `aspectRatio` together. `CONFIG.referenceTierDirs` is an ordered list of
reference folders from most images to fewest; a tag is tried against each tier in turn until one succeeds, so
reference-richness stays high for the tags that succeed first try while the hard cases recover by shrinking the
request rather than retrying it unchanged. `references/tags/community/rejects/` is not part of the chain.

## Filename Slugging

`slugifyTagName`: lowercase, accents/quotes stripped, `&` → `-and-`, other non-alphanumerics collapsed to hyphens,
leading/trailing hyphens stripped. Every key in `config/` lists is matched by slug, every key in
`3-tags-curated.json` and `4-tags-resolved.json` is a slug. Tags with no Latin/alphanumeric content slugify to an
empty string and are dropped by `tags:candidates`.

## Key Scripts

- `npm run tags:fetch` / `tags:candidates` / `tags:build` / `tags:update` / `tags:triage` / `tags:generate` — see above
- `npm run knip` — unused exports/files · `npm run lint` / `lint:fix` — ESLint · `npm run prettier` /
  `prettier:fix` — Prettier · `npm run typecheck` — TypeScript · `npm run test` — Vitest ·
  `npm run check` — all of the above

Data-writing scripts emit plain `JSON.stringify` output; run `npm run prettier:fix` before `npm run check`.

## Environment Variables

- `GEMINI_API_KEY` — only for `tags:generate`. Free tier quotas can bite on a full run; `CONFIG.requestDelayMs`
  assumes a paid plan.
- `TAGS_API_URL` / `TAGS_API_KEY` / `TAGS_API_ORIGIN` — only for `tags:fetch`. See `.env.sample`.

## Deployment

Vercel static site, no build. `.vercelignore` allow-lists `assets/` and `data/4-tags-resolved.json`; deployed
paths mirror repo paths (`/assets/tags/community/<slug>.jpg`, `/data/4-tags-resolved.json`). New top-level
folders that should be served need a `!`-exception.

## Coding Conventions

- ESLint (flat config) and Prettier enforce style (`.prettierrc`, `.editorconfig`)
- All top-level exports have a succinct JSDoc comment
- Tunables (paths, limits) live in a script's top `CONFIG` block; **word lists live in `config/*.json`, never in
  code**

## Maintaining These Instructions

Keep this file current when the code changes, and `spec.md` current when the design changes (a new rule, a changed
curation rule, a deferred item getting built). If unsure which, update both.
