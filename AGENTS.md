# Agent Instructions

## Project Overview

`chromatix-assets` is an image asset repository for Chromatix, holding thumbnail images for community tags (genres,
moods, styles). It's a standalone Node/TypeScript project with its own `package.json` and dependencies.

Images can be added to `assets/tags/community/` by hand. The project also includes an optional script
(`lib/tagImageGenerator.ts`) that generates new tag thumbnails via the Gemini API, for cases where that's more
practical than sourcing or creating images manually — see [Tag Image Generation](#tag-image-generation) below.

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
  tags.json                  # Source list of tag names to generate images for
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
      <slug>.jpg               # Generated output, one per tag
lib/
  tagImageGenerator.ts          # Main generator script - all config lives in the CONFIG block at its top
  slugifyTagName.ts             # Tag name -> filename slug helper
```

## Tag Image Generation

This is an optional workflow for populating `assets/tags/community/` via the Gemini API, as an alternative to adding
images by hand.

`lib/tagImageGenerator.ts` reads `CONFIG.tagsFile` (`data/tags.json`), and for each tag not already present in
`CONFIG.outputDir` (`assets/tags/community/`), calls the Gemini API with `CONFIG.prompt` (a template string with a
`{{tag}}` placeholder) plus a set of reference images to steer style/composition, then crops/resizes the result to
`CONFIG.width` x `CONFIG.height` with `sharp` and writes it to `assets/tags/community/<slug>.jpg`.

**All tunables live in the `CONFIG` object at the top of the file** — model, prompt text, output dimensions, file
paths, reference tiers, request delay, max generations per run, and `startTag` (for resuming/testing from partway
through the list). This is deliberate: anyone picking up the script should be able to see and change every knob in
one place without reading the implementation.

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
characters collapsed to hyphens, leading/trailing hyphens stripped).

A single call to `slugifyTagName` sometimes collapses two distinct tag names to the same slug (e.g. differing only by
punctuation) — the generator doesn't currently dedupe against this, so the later tag in `tags.json` will just find an
existing file and be skipped. This has come up before as "why did some tags never generate" - check for a slug
collision with an already-generated tag before assuming it's an API failure.

## Key Scripts

- `npm run tags:generate` — run the generator against `data/tags.json`
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run prettier` / `npm run prettier:fix` — Prettier
- `npm run typecheck` — TypeScript, no emit
- `npm run check` — lint + prettier + typecheck

## Environment Variables

- `GEMINI_API_KEY` — Gemini API key, only required if using the optional generator script. Set in `.env` or
  `.env.local` (see `.env.sample`).
  Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free tier has daily/per-minute
  quota limits that a full run can hit; a paid plan removes most of that friction (this is why
  `CONFIG.requestDelayMs` is low by default - it assumes a paid plan; lower it further at your own risk, or raise it
  back up if running on the free tier).

## Deployment

Deploys to Vercel as a static site — no build step, no framework. `vercel.json` sets `buildCommand`/`installCommand`
to `false`, and `.vercelignore` scopes the deploy to just `assets/` and `data/tags.json` (everything else — `lib/`,
`references/`, config files — is excluded). Paths are unprefixed, so deployed URLs mirror the repo paths, e.g.
`/assets/tags/community/<slug>.jpg` and `/data/tags.json`. If new top-level folders are added that should be
publicly served, `.vercelignore` needs a matching `!`-exception or they won't be included.

## Coding Conventions

- ESLint (flat config) and Prettier enforce code style (`.prettierrc`, `.editorconfig`)
- All top-level exports should have a clear, succinct JSDoc comment
- Config belongs in the `CONFIG` block at the top of a script, not scattered as inline magic values

## Maintaining These Instructions

These instructions are for AI agents. When you make changes to this project, keep this file up to date — especially
the folder structure and the retry/tiering rationale, since those are non-obvious design decisions future changes
could easily break.
