# Tag Resolution — Spec & Implementation Plan

Companion to AGENTS.md. This file is the source of truth for the tag-resolution rework: what we're solving, the
design, the curation rules, and the exact task list. AGENTS.md describes whatever the code currently does and
must be rewritten at the end of the task list (task 9).

## 1. Goal

Every raw tag string a Chromatix user has (genre/mood/style, free text, thousands of independent Plex libraries)
must resolve to one thumbnail image, while the set of images we _generate and curate_ stays small and stops
growing with junk. Constraints:

- **Deterministic at runtime**: given a tag string, the image is a fixed function of string + shipped data.
- **Bounded**: new junk/variant tags cost zero generation and zero curation beyond a one-line decision.
- **Judgement is allowed, but only once and only in data**: classification (is this junk? is this a spelling of
  Rock?) may be done by a human or an LLM, but the result is frozen into `data/3-tags-curated.json`. Nothing at
  build or run time re-decides it.

## 2. Facts (measured 2026-09-03, updated after the §5 task-list pass — re-measure, don't trust)

- `data/1-tags-raw.json` grew from 1,935 to 2,573 raw strings mid-implementation (real new data, not corruption -
  see §5 task 1's note). `data/2-candidates.json`: 2,579 candidate slugs, 438 compounds.
- `data/3-tags-curated.json` (post-curation): 2,065 canonical, 373 aliases, 141 junk, 0 undecided.
- `data/4-tags-resolved.json`: 2,065 canonical, 373 aliases. 459 canonical slugs have no image yet (tags:generate's
  queue). `assets/tags/community/`: originally 1,868 images; `tags:build` copied 131 more for aliases.
- Slug collisions between distinct tags: 0, re-verified across the full 2,579-slug curated set (every slug in
  `3-tags-curated.json` is unique - `curatedTags.ts`'s validation enforces this on every load).
- The Chromatix app resolves `slugifyTagName(tag)` → `<slug>.jpg`, with a fallback image on load error. It does
  not fetch any JSON today. Alex is willing to change the app.
- The API returns tag names only — no counts, no genre/mood/style field. Frequency filtering is impossible for
  now; mood-vs-genre must be decided in curation.
- ~285 raw tags are several tags joined by `,` / `&` / `and`. But Plex/AllMusic mood tags are also `"X & Y"`
  (`Calm & Peaceful`) and are ONE tag — a splitter can't tell these apart; curation must.
- `references/` reference tiers and the Gemini generator work; leave them alone.

## 3. Design

### 3.1 Runtime contract (app side)

```
slug = slugifyTagName(tag)
target = resolved[slug] ?? null
image = target ? `${CDN}/assets/tags/community/${target}.jpg` : FALLBACK
```

`data/4-tags-resolved.json` is deployed from this repo as a single flat map: `{ [slug]: canonicalSlug }` - every
known slug (canonical or alias/related) maps directly to its canonical slug; a canonical slug maps to itself. One
lookup, no branching, and it scales to resolving hundreds of tags at once (the app's actual use case) with no extra
cost - it's still just one object-key lookup per tag. Junk tags are absent → fallback (the app may later choose to
hide them). This was originally a two-part `{ canonical: string[], aliases: {...} }` shape; flattened after review
made clear the app never needs to distinguish "canonical" from "alias" at lookup time, only "what slug do I load".

Until the app is updated, `tags:build` also **copies** each canonical image to its alias slugs
(`rock.jpg` → `rok.jpg`), so aliases work with the current app. Git dedups identical blobs; the copies can be
deleted once the app uses the JSON.

### 3.2 Data model

- `data/1-tags-raw.json` — unchanged. Raw, unfiltered, append-only, from `tags:fetch`.
- `data/blocklist.json` — unchanged. Hand list of structurally-valid but meaningless strings. (Kept separate
  from `junk` below because it's applied _before_ splitting, so `"Rock, Misc"` still yields `rock`.)
- `data/2-candidates.json` — **derived, stateless, regenerated every run**. Output of `tags:candidates`:
  ```json
  {
    "adult-alternative-pop-and-rock": {
      "variants": ["Adult Alternative Pop & Rock"],
      "parts": ["adult-alternative-pop", "rock"],
      "primary": "rock"
    },
    "rock": { "variants": ["Rock", "rock", "ROCK"] }
  }
  ```
  Keyed by slug. `parts`/`primary` present only for compounds. Parts are also added as their own candidate slugs.
- `data/3-tags-curated.json` — **the only durable, hand/LLM-edited file**:
  ```json
  {
    "canonical": { "rock": { "name": "Rock", "aliases": ["rok", "general-rock"], "related": ["meme-rock"] } },
    "junk": ["misc", "tyler-the-creator"]
  }
  ```
  `aliases` = same tag, different string (spelling, casing already collapsed, translation, acronym, genre-list
  compound). `related` = a different, minor tag that borrows this image instead of getting its own. Both resolve
  identically at runtime; the split exists so future review can revisit `related` (editorial) separately from
  `aliases` (factual). Every slug appears in at most one place across canonical keys / aliases / related / junk.
- `data/4-tags-resolved.json` — **derived** by `tags:build`, deployed. Flattening of the above.

### 3.3 Scripts

| Script            | Reads                                                    | Writes                                                    | Stateful?              |
| ----------------- | -------------------------------------------------------- | --------------------------------------------------------- | ---------------------- |
| `tags:fetch`      | API                                                      | `1-tags-raw.json`                                         | append-only (existing) |
| `tags:candidates` | raw, blocklist                                           | `2-candidates.json`                                       | no                     |
| `tags:triage`     | candidates, curated                                      | stdout                                                    | no                     |
| `tags:build`      | curated, images                                          | `4-tags-resolved.json`, alias image copies, stdout report | no                     |
| `tags:generate`   | `4-tags-resolved.json` (canonical minus existing images) | images                                                    | existing               |

`tags:triage` prints candidate slugs not present anywhere in curated (with variants, parts, primary, and whether an
image already exists). That list is the review queue. There is no `-seen` state: "already decided" == "present
in curated".

`tags:build` also reports: canonical slugs with no image (generator input), images whose slug is in `junk` or
is an alias/related (candidates for deletion — never auto-deleted), and curated slugs that no longer appear in
candidates (informational).

## 4. Curation rules (for the LLM/human pass and for `tags:triage` follow-ups)

Apply in order to each undecided candidate slug:

1. **Junk** if it is not a genre/mood/style: artist, label (`matador-records`), venue/city (`porto`), playlist or
   personal note (`favourite-boris`, `full-albums`), placeholder (`default`, `various`, `what`, `genre`), profanity
   noise, or a bare word that only exists as split debris with no standalone meaning (`central`, `south`, `and-country`).
   `music`/`musik` alone is junk. Era words alone (`classic`) are junk; decades (`eighties`) are fine.
2. **Alias** if it is the same tag as an existing canonical: typo (`electrionic`), translation (`klassik`,
   `musiques-du-monde`), acronym (`d-and-b`), `general-*` prefix (`general-rock`), or a **genre-list compound**
   (`techno-and-house`, `blues-country-folk`) → alias of its `primary` (after resolving the primary itself; if the
   primary is junk, use the next part). Prefer the slug that already has an image as canonical.
3. **Single-tag compound**: `"X & Y"` that is one Plex/AllMusic/iTunes tag stays **canonical**: mood pairs
   (`calm-and-peaceful`, `tense-and-anxious` — adjectives, not genres), fixed names (`drum-and-bass`,
   `rock-and-roll`, `rhythm-and-blues` → alias of `r-and-b`, `country-and-irish`, `big-band-and-swing`,
   `stage-and-screen` → alias of `soundtrack`, `folk-world-and-country`). Test: would anyone type only half of it?
   AllMusic "Pop/Rock" styles arrive as `x-pop-and-rock` — alias to the nearest canonical (`pop-rock`, `alternative-rock`).
4. **Related** if it is a real but very niche tag that doesn't warrant its own image (`mathematic-metal` →
   `metal`, `kaballah-doom` → `doom-metal`). Use sparingly; when in doubt, canonical (it already has an image).
5. Otherwise **canonical**, `name` = the best-cased variant (else Title Case of slug), no aliases.

Do not split moods. Do not merge distinct genres because they're similar (`deep-house` ≠ `tech-house`;
`electronic` ≠ `electronica` — both stay canonical). Split halves of a single-tag compound go to `junk` unless
they stand alone (`calm`, `anxious` are real moods → canonical).

The seed already in `data/3-tags-curated.json` (114 canonical, 240 aliases, 60 junk) is the calibration set —
follow its pattern. Undecided at seed time: 1,581 slugs, the large majority of which are rule 5.

## 5. Task list — DONE (2026-09-03)

All nine tasks below are complete; `npm run check` is green. Kept here as a record of what was built and why,
not as a to-do list.

1. **`lib/buildCandidates.ts`** (`npm run tags:candidates`) — done. Stateless, uses `isValidTag`, `splitMultiTag`,
   `selectPrimaryTag`, `slugifyTagName`; blocklist compared by slug. Note: the original acceptance fixture
   (`data/2-candidates.json` as committed at planning time, ~1,935 raw tags) was stale by the time this ran —
   `data/1-tags-raw.json` had grown to ~2,573 tags in the interim (real new data, confirmed by spot-check, not
   corruption). The script's logic was validated against the _old_ data's shape instead, then run for real
   against current data — 2,579 candidate slugs, 438 compounds. Re-verify this kind of thing whenever a "must
   match X" instruction spans a raw data file that keeps growing.
2. **`lib/curatedTags.ts`** — done, with `loadCurated`/`resolveSlug`/`validateCurated`, 12 unit tests.
3. **`lib/triageTags.ts`** (`npm run tags:triage`, `-- --json`) — done.
4. **`lib/buildResolved.ts`** (`npm run tags:build`) — done, including the alias image-copy step and three
   reports (missing images, deletion candidates, stale curated slugs).
5. **Generator** — done. Reads `4-tags-resolved.json` for the canonical slug list and `3-tags-curated.json` for each
   slug's display name.
6. **Curation pass** — done. 2,065 canonical / 373 aliases / 141 junk, 0 undecided against current
   `2-candidates.json`. One correction made mid-pass and worth flagging for future curators: an early batch
   miscategorized bare nationality/regional words (`irish`, `turkish`, `cuban`, `polish`, `ukrainian`, `persian`,
   `english`, `british`, `salvadoran`, `zimbabwean`, `bahamian`) as junk — these are legitimate regional-music
   genre tags in this data (same category as `african`, `japanese`, `korean`), not junk. Caught and fixed before
   building `4-tags-resolved.json`; the lesson is to check a candidate against what's _already_ canonical before
   bulk-classifying anything that looks like a plain noun/adjective.
7. **Old pipeline deleted** — done. Removed `filterTags.ts`, `splitTags.ts`, `normalizeTags.ts`, `normalizeTag.ts`
   (+ test), `data/2-*`, `data/3-*`, `data/4-*`.
8. **Deploy config + README** — done. `.vercelignore` now allow-lists `data/4-tags-resolved.json`.
9. **AGENTS.md rewritten** — done, matches the current pipeline.

**Not yet done** (out of scope for this pass, tracked separately): the app-side switch to the §3.1 JSON lookup
(Alex, app repo) — until then, the alias image copies from `tags:build` are load-bearing in production, not a
stopgap. Once the app switches, the copies can be pruned with a small `tags:build --prune-copies` if wanted.

## 6. Deferred / not doing

- Levenshtein/fuzzy suggestions in `tags:triage` — only if the queue after a fetch is ever big enough to hurt.
- Language detection / machine translation — an LLM curation pass handles translations; no dependency needed.
- Frequency threshold — needs API counts; revisit if the backend can expose them.
- Genre/mood/style separation — needs the API field; would let the splitter skip moods automatically.
- Deleting junk/alias images — `tags:build` reports them; deletion stays a manual, reviewable commit.
- Nested-parenthetical compounds (`drum & bass (drill & bass)`) — one instance; handled by curation, not code.
