# Agent Instructions

## Project Overview

`chromatix-assets` is an image asset repository for Chromatix, holding thumbnail images for community tags (genres,
moods, styles). It's a standalone Node/TypeScript project with its own `package.json` and dependencies.

Images can be added to `assets/tags/community/` by hand. The project also includes a tag resolution pipeline that
turns the Chromatix API's raw (large, messy) tag list into a small, curated set of canonical tags (see
[Tag Resolution Pipeline](#tag-resolution-pipeline) below), and `lib/tagImageGenerator.ts`, which generates new tag
thumbnails via the Gemini API for cases where that's more practical than sourcing or creating images manually (see
[Tag Image Generation](#tag-image-generation) below).

See `spec.md` for the design rationale behind the pipeline - what problem it solves, the specific classes of junk and
ambiguity found in the raw tag data, the curation rules, and what's still unbuilt (fuzzy-matching, translation,
frequency filtering - see `spec.md` §6, deferred until they're actually needed). This file (AGENTS.md) documents how
the pipeline works today; `spec.md` documents why it's shaped this way.

## Tech Stack

- **Node.js 24+** — runs `.ts` files directly via native TypeScript type stripping; no build step
- **TypeScript** — all scripts are `.ts`
- **@google/genai** — Gemini API client, used with the `gemini-2.5-flash-image` model
- **sharp** — resizes/crops generated images to the target output dimensions
- **chalk** — console log styling
- **dotenv** — loads `GEMINI_API_KEY` from `.env` / `.env.local`

## Project Structure

```
data/
  1-tags-raw.json          # INPUT. Every tag the Chromatix API has ever returned. Raw, unfiltered, append-only.
  2-candidates.json        # DERIVED, stateless. Valid tags grouped by slug, multi-tag strings split.
  3-tags-curated.json      # DURABLE. The only hand/LLM-edited source of truth for canonical tags/aliases/junk.
  4-tags-resolved.json     # DERIVED, DEPLOYED. Flat { [slug]: canonicalSlug } lookup for the app.
  blocklist.json           # DURABLE. Hand-maintained list of structurally-valid but semantically meaningless tags
  tags-triage.json         # DERIVED, transient (unnumbered - a side artifact, not a pipeline step). Undecided
                            #   candidates awaiting a curation decision.
references/
  tags/
    community/
      thumbnails1/            # Reference images, tier 1 (most images - tried first)
      thumbnails2/             # Tier 2 (fewer images - tried if tier 1 fails)
      thumbnails3/
      thumbnails4/
      thumbnails5/             # Smallest tier - last resort before giving up on a tag
      rejects/                 # Discarded reference images kept for reference - NOT used by the generator
assets/
  tags/
    community/
      <slug>.jpg               # Generated output, one per canonical tag (plus a copy per alias - see below)
lib/
  tagFetcher.ts             # tags:fetch - pulls raw tags from the Chromatix API, no filtering
  buildCandidates.ts        # tags:candidates - filters, splits, and groups raw tags into 2-candidates.json
  triageTags.ts             # tags:triage - lists candidates not yet decided in 3-tags-curated.json
  buildResolved.ts          # tags:build - flattens curated tags into 4-tags-resolved.json + alias image copies
  curatedTags.ts            # loadCurated/resolveSlug/validateCurated - the schema for 3-tags-curated.json
  isValidTag.ts              # Structural validity check used by buildCandidates.ts
  isValidTag.test.ts
  splitMultiTag.ts           # Explodes a delimited tag string into parts, protecting known "X & Y" tags
  splitMultiTag.test.ts
  selectPrimaryTag.ts        # Picks a compound tag's default fallback part (deprioritizes qualifier words)
  selectPrimaryTag.test.ts
  slugifyTagName.ts          # Tag name -> filename slug helper
  slugifyTagName.test.ts
  tagImageGenerator.ts       # tags:generate - generates a thumbnail for every canonical tag with no image yet
```

## Tag Resolution Pipeline

The raw tag list from the Chromatix API is large and messy (thousands of free-text strings from independently
managed Plex libraries worldwide - misspellings, translations, multiple genres joined into one string, personal
notes, artist names, etc). Rather than generating an image per raw string, this pipeline resolves the raw list down
to a small, curated set of canonical tags, each with one image - see `spec.md` §1-2 for the full problem statement
and measured facts.

**Only one file is durable and hand-edited: `data/3-tags-curated.json`.** Everything else under `data/` (other than
`1-tags-raw.json`, which is append-only from the API) is mechanically derived and safe to delete/regenerate at any
time.

- **`npm run tags:fetch`** (`lib/tagFetcher.ts`) - Fetches from the Chromatix API (`CONFIG.apiUrl`, authenticated
  with the `X-Api-Key` header from `TAGS_API_KEY`, plus a required `Origin` header from `TAGS_API_ORIGIN` - the API
  rejects requests with a 403 if it's missing) and merges the result into `data/1-tags-raw.json`, keeping the file
  alphabetised (case-insensitive) with no duplicates. **Applies no filtering or validation at all.** The merge only
  ever adds tags, never removes one, even if the API stops returning it.

- **`npm run tags:candidates`** (`lib/buildCandidates.ts`) - **Stateless**, fully regenerated every run (no
  incremental/seen-file state - always safe to just re-run). Reads `data/1-tags-raw.json`, and for each tag:
  - Drops it if it fails `isValidTag` (`lib/isValidTag.ts` - structural validity: length bounds, not purely
    numeric, not fully bracket-wrapped, not domain/URL-like, contains at least one Latin letter/digit once
    diacritics are stripped) or slugifies to an entry in `data/blocklist.json` (a small hand-maintained list of
    tags that are structurally fine but semantically meaningless, e.g. `"Misc"`, `"Test"` - extend this file
    whenever a new one turns up, rather than adding a one-off code special-case).
  - Splits it via `splitMultiTag` (`lib/splitMultiTag.ts`) if it's really several tags joined by a comma or a
    whitespace-surrounded `"&"`/`"and"` (e.g. `"Ambient & New Age & Cosmic"`). `splitMultiTag` protects a short
    list of known "X & Y" tags that are legitimately a single tag (`"Drum & Bass"`, `"Rock & Roll"`, `"Rhythm &
Blues"`, `"Town & Country"`) even when they appear alongside other delimited tags in a larger list. Each split
    part is re-validated the same way, since splitting can reveal junk invisible in the joined string (e.g. a bare
    year sitting in a longer comma-separated list).
  - Groups every kept tag/part by slug (`slugifyTagName`) into `data/2-candidates.json`:
    `{ [slug]: { variants: string[], parts?: string[], primary?: string } }`. `parts`/`primary` are only present
    when the slug is itself a compound; `primary` is computed by `selectPrimaryTag` (`lib/selectPrimaryTag.ts` -
    the first part not starting with a known pure qualifier word like `"adult"`; see that file for why the
    qualifier list is deliberately short).

- **`npm run tags:triage`** (`lib/triageTags.ts`) - **Stateless.** Reads `data/2-candidates.json` and
  `data/3-tags-curated.json`, and prints every candidate slug not yet present anywhere in the curated data (not a
  canonical key, alias, related tag, or junk entry). "Already decided" == "present in curated" - there's no
  separate seen-file. This is the review queue - see `spec.md` §4 for the rules to apply. Two alternate modes:
  - `-- --json` writes `data/tags-triage.json` (gitignored, transient) instead of printing, for scripted use.
  - `-- --prompt` writes `data/curation-prompt.md` (gitignored, transient): a single self-contained prompt -
    the curation rules quoted live from `spec.md` §4 (extracted at generation time, so it can't drift out of
    sync), the undecided candidates, and exact instructions for editing `data/3-tags-curated.json`. Paste its
    contents into a Claude chat to get the file updated; does nothing (no file written) if nothing's undecided.

- **`data/3-tags-curated.json`** - the durable file. Loaded/validated via `lib/curatedTags.ts` (`loadCurated`,
  `resolveSlug`, `validateCurated` - every slug must appear in at most one of: a canonical key, an alias, a related
  tag, or junk; every alias/related target must itself be a canonical key). Shape:

  ```json
  {
    "canonical": {
      "rock": { "name": "Rock", "aliases": ["rok", "general-rock"], "related": ["mathematic-metal"] }
    },
    "junk": ["misc", "tyler-the-creator"]
  }
  ```

  `aliases` = same tag, different string (typo, translation, acronym, `general-*` prefix, or a genre-list compound
  aliased to its resolved primary). `related` = a different, minor tag that deliberately borrows this image instead
  of getting its own (an editorial call, never mechanically populated). Both resolve identically at runtime - the
  split exists purely so `related` decisions can be revisited independently of factual `aliases` later. See
  `spec.md` §4 for the full curation rules used to decide where an undecided slug goes.

- **`npm run tags:build`** (`lib/buildResolved.ts`) - **Stateless.** Reads `data/3-tags-curated.json` and writes
  `data/4-tags-resolved.json` (the deployed file - see [Deployment](#deployment)): a single flat map,
  `{ [slug]: canonicalSlug }`, covering every canonical/alias/related slug (a canonical slug maps to itself; an
  entry's `aliases` and `related` both map to that entry's canonical slug). One lookup, no branching - see
  [Runtime Resolution](#runtime-resolution). Also **copies** each canonical tag's image to every one of its
  alias/related slugs
  (e.g. `rock.jpg` → `rok.jpg`) - this is what makes an alias resolve correctly under the current app, which only
  does a direct `slugifyTagName(tag) → <slug>.jpg` lookup with no JSON fetch (see
  [Runtime Resolution](#runtime-resolution) below). Copies are skipped if the target already has identical bytes,
  so re-running is cheap. Finally prints three informational reports (nothing is ever auto-deleted): canonical
  slugs with no image yet (this is `tags:generate`'s input), images whose slug is junk/alias/related (candidates
  for eventual deletion once the app reads the JSON directly instead of relying on copies), and curated slugs no
  longer present in `2-candidates.json` (the API may have stopped returning that raw tag).

- **`npm run tags:generate`** (`lib/tagImageGenerator.ts`) - see [Tag Image Generation](#tag-image-generation).

**Routine workflow for processing newly-fetched tags** (repeat as often as you like):

1. `npm run tags:update` — runs `tags:fetch` → `tags:candidates` → `tags:triage` → `tags:build` in one go (image
   generation is deliberately excluded - see step 4). Fully deterministic given fixed inputs, except for one thing
   it does NOT do: it never writes to `data/3-tags-curated.json`. Any newly-fetched tag not yet curated stays
   undecided - `tags:build` just excludes it from `data/4-tags-resolved.json`, and `tags:triage`'s printed output
   (non-blocking) reports how many are waiting. Curation is the one deliberately non-automated step in this
   pipeline (see `spec.md` §1) - this command surfaces what needs a decision without making it for you.
2. If step 1 reported undecided tags: run `npm run tags:triage -- --prompt`, then paste the resulting
   `data/curation-prompt.md`'s contents into a Claude chat. It's self-contained (quotes the current curation
   rules from `spec.md` §4 live, includes the undecided list, and gives exact instructions), so Claude can edit
   `data/3-tags-curated.json` directly from that one paste. Skip this step if step 1 reported 0 undecided.
3. `npm run tags:build` — re-run now that `3-tags-curated.json` has changed, so the newly-curated tags are
   actually reflected in `data/4-tags-resolved.json` (step 1's `tags:build` ran _before_ curation, so it won't
   have picked them up).
4. `npm run tags:generate` — generates images for any canonical tag that still doesn't have one, including
   whatever was just added in step 2.

## Runtime Resolution

The Chromatix desktop app resolves a tag to an image with `slugifyTagName(tag)` → `<slug>.jpg`, falling back to a
generic image if that file doesn't load. It does not fetch any JSON today. This means:

- A tag whose slug already matches a canonical or alias slug resolves correctly with **no code change needed** -
  this is why `tags:build` copies alias images under their alias slug rather than only shipping a JSON map.
- A tag the pipeline has never seen (not yet in `2-candidates.json`/`3-tags-curated.json`) has no image and falls back
  to the generic image, until a future `tags:fetch` + curation pass gives it one.

`data/4-tags-resolved.json` is deployed (see [Deployment](#deployment)) so the app can eventually move to a direct
JSON lookup instead of relying on file copies for aliases - see `spec.md` §3.1 for the intended app-side contract.
That app-side change hasn't happened yet; until it does, the image-copy behavior above is load-bearing.

## Tag Image Generation

This is an optional workflow for populating `assets/tags/community/` via the Gemini API, as an alternative to adding
images by hand.

`lib/tagImageGenerator.ts` reads `data/4-tags-resolved.json`'s `canonical` list and `data/3-tags-curated.json` (for each
slug's display `name`, used in the prompt instead of the raw slug), and for each canonical slug not already present
in `CONFIG.outputDir` (`assets/tags/community/`), calls the Gemini API with `CONFIG.prompt` (a template string with
a `{{tag}}` placeholder) plus a set of reference images to steer style/composition, then crops/resizes the result to
`CONFIG.width` x `CONFIG.height` with `sharp` and writes it to `assets/tags/community/<slug>.jpg`. **Only canonical
slugs are ever generated** - an alias/related slug gets its image via `tags:build`'s file copy, never its own
generation.

**All tunables live in the `CONFIG` object at the top of the file** — model, prompt text, output dimensions, file
paths, reference tiers, sampling temperature, request delay, max generations per run, and `startTag` (for
resuming/testing from partway through the list, matched by canonical slug). This is deliberate: anyone picking up
the script should be able to see and change every knob in one place without reading the implementation.

Each request also gets a random `seed`, generated per call rather than fixed in `CONFIG`. Combined with
`CONFIG.temperature`, this means deleting a generated image and re-running the script produces a genuinely different
result for that tag rather than reliably reproducing the same image.

### Why the reference-tier retry logic exists

Gemini's image model (`gemini-2.5-flash-image`) can fail generation for a given request with
`finishReason: "IMAGE_OTHER"` and no other diagnostic information (no `promptFeedback`, no block reason) — this was
investigated at length during development. Confirmed via isolated testing:

- It is **not** a content-safety block — the same tag name generates fine in isolation (bare prompt, no references).
- It is **not** a rate-limit issue — rate limiting surfaces as an HTTP 429 / `ApiError`, not `IMAGE_OTHER`.
- It **is** correlated with overall request complexity/size — the failure only reproduced when the full combination
  (long prompt + many reference images + the `aspectRatio` config) was sent together; each piece alone succeeded.
  More reference images made failures more frequent, but it remained somewhat non-deterministic near that threshold —
  the same tag could fail 3 retries in a row with an unchanged request, but succeed reliably once the reference count
  was reduced.

The practical fix: `CONFIG.referenceTierDirs` is an ordered list of reference folders from most images to fewest
(`thumbnails1` → `thumbnails5`). For each tag, the generator tries tier 1 first; if that request comes back with no
image, it retries the same tag against tier 2, and so on, before giving up on that tag for the run. This keeps
reference-richness high for the (most) tags that succeed on the first try, while still recovering the harder cases by
shrinking the request instead of just retrying it unchanged (which does not reliably help - it's a request-shape
problem, not transient flakiness).

`references/tags/community/rejects/` is **not** part of this tier chain — it's just a holding place for reference
images that were tried and discarded, kept for reference rather than deleted.

Already-generated tags are always skipped (based on whether `assets/tags/community/<slug>.jpg` exists), so the script
is safe to simply re-run to pick up anything that failed on a previous pass, or to continue past
`CONFIG.maxGenerationsPerRun`.

## Filename Slugging

Tag names are converted to filenames via `slugifyTagName` (lowercase, hyphenated, `&` → `and`, other non-alphanumeric
characters collapsed to hyphens, leading/trailing hyphens stripped). Every key in `data/3-tags-curated.json`
(canonical, alias, related, junk) is itself already a slug produced by this function.

`slugifyTagName` strips accents/diacritics but has no transliteration for non-Latin scripts (Cyrillic, CJK, etc.), so
a tag made up entirely of such characters slugifies to an empty string. `lib/buildCandidates.ts` explicitly skips any
tag whose slug is empty, so it never reaches `2-candidates.json` and never collides with any other such tag on the
same output filename.

A single call to `slugifyTagName` can in principle collapse two genuinely _different_ tags to the same slug (as
opposed to two spellings of the _same_ tag, which is the intended/desired behavior). Not currently asserted against

- see `spec.md`'s Known Limitations for why this hasn't come up in practice yet.

## Key Scripts

- `npm run tags:fetch` — fetch raw tags from the Chromatix API into `data/1-tags-raw.json`, unfiltered
- `npm run tags:candidates` — build `data/2-candidates.json` from the raw list (filter, split, group by slug)
- `npm run tags:triage` — list candidates not yet decided in `data/3-tags-curated.json` (`-- --json` for a file,
  `-- --prompt` for a paste-into-Claude curation prompt)
- `npm run tags:build` — flatten curated tags into `data/4-tags-resolved.json` + copy alias images
- `npm run tags:update` — runs fetch → candidates → triage → build in one go (excludes `tags:generate`)
- `npm run tags:generate` — generate a thumbnail for every canonical tag that doesn't have one yet
- `npm run knip` — run [knip](https://knip.dev/) (unused exports/files)
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run prettier` / `npm run prettier:fix` — Prettier
- `npm run typecheck` — TypeScript, no emit
- `npm run test` — Vitest unit tests
- `npm run check` — knip + lint + prettier + typecheck + test

## Environment Variables

- `GEMINI_API_KEY` — Gemini API key, only required if using the optional generator script. Set in `.env` or
  `.env.local` (see `.env.sample`).
  Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free tier has daily/per-minute
  quota limits that a full run can hit; a paid plan removes most of that friction (this is why
  `CONFIG.requestDelayMs` is low by default - it assumes a paid plan; lower it further at your own risk, or raise it
  back up if running on the free tier).
- `TAGS_API_URL` / `TAGS_API_KEY` / `TAGS_API_ORIGIN` — endpoint, API key, and required `Origin` header value for
  the Chromatix tags API, only required if using the optional fetcher script. Set in `.env` or `.env.local` (see
  `.env.sample`).

## Deployment

Deploys to Vercel as a static site — no build step, no framework. `vercel.json` sets `buildCommand`/`installCommand`
to `false`, and `.vercelignore` scopes the deploy to `assets/` and `data/4-tags-resolved.json` (everything else -
`lib/`, `references/`, `data/3-tags-curated.json`, `data/2-candidates.json`, config files - is excluded). Paths are
unprefixed, so deployed URLs mirror the repo paths, e.g. `/assets/tags/community/<slug>.jpg` and
`/data/4-tags-resolved.json`. If new top-level folders are added that should be publicly served, `.vercelignore` needs
a matching `!`-exception or they won't be included.

`data/4-tags-resolved.json` is deployed for future use by the app (a direct JSON-based lookup - see
[Runtime Resolution](#runtime-resolution)); the app doesn't consume it yet, so today it's the image file copies
under `assets/` (produced by `tags:build`) that actually make aliases work in production.

## Coding Conventions

- ESLint (flat config) and Prettier enforce code style (`.prettierrc`, `.editorconfig`)
- All top-level exports should have a clear, succinct JSDoc comment
- Config belongs in the `CONFIG` block at the top of a script, not scattered as inline magic values

## Maintaining These Instructions

These instructions are for AI agents. When you make changes to this project, keep this file up to date — especially
the folder structure and the retry/tiering rationale, since those are non-obvious design decisions future changes
could easily break.

`spec.md` is a companion document describing the _design_ of the tag-resolution pipeline — the problem it solves,
the specific edge cases/failure modes in the raw tag data, the curation rules, and what's deliberately deferred (see
its §6). It exists so the overall approach can be reviewed independently of the implementation. **Keep it up to date
whenever the pipeline's design changes** — a new stage, a new class of tag problem discovered in the data, a changed
curation rule, or a previously-deferred item getting built should all be reflected there, not just in code comments.
If you're not sure whether a change is "code detail" (AGENTS.md territory) or "design decision" (spec.md territory),
prefer documenting in both over neither.
