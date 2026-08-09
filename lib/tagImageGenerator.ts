// ======================================================================
// TAG IMAGE GENERATOR
// ======================================================================
//
// Generates a thumbnail image for every tag in CONFIG.tagsFile that doesn't already have one, using
// the Gemini API conditioned on a set of reference images. Already-generated tags are always skipped,
// so this script can simply be re-run to pick up anything missing from a previous run.
//
// Usage: npm run tags:generate

import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

import { slugifyTagName } from './slugifyTagName.ts';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

// ======================================================================
// CONFIG
// ======================================================================

const CONFIG = {
  // Gemini model to generate images with
  model: 'gemini-2.5-flash-image',

  // Prompt sent with every request. {{tag}} is replaced with the tag name being generated.
  prompt: `Create a music genre thumbnail image representing the mood/genre "{{tag}}". Use the reference images as a rough starting guide. Images should be relatively clean and simple, and identifiable at a glance. They should be vibrant, bold and playful. Do not include any text, words, letters, numbers, or typography anywhere in the image — the image must be purely visual/abstract artwork with no writing of any kind. Where possible, pick a colour that suits the genre, and make that a key colour in the image. Compose the image as a wide landscape shot with the main subject centred, since it will be used as a landscape thumbnail. The subject can be artistically cropped if it serves the image well, for example zooming in on a single object or character. The image should be visually striking and memorable, with a clear focal point.`,

  // Output image dimensions (5:3 aspect ratio)
  width: 500,
  height: 300,

  // Input tags list, and where generated images are written to (as <slug>.jpg)
  tagsFile: './data/tags.json',
  outputDir: './assets/tags/community',

  // Reference folders, tried in order for each tag - most references first. A request that fails with
  // no image (e.g. finishReason "IMAGE_OTHER") is retried using the next (smaller) reference set, since
  // fewer references reduces the odds of overloading the model's image-fusion capacity.
  // Note: references/tags/community/rejects is excluded - it holds discarded reference images, not a
  // fallback tier.
  referenceTierDirs: [
    './references/tags/community/thumbnails10',
    './references/tags/community/thumbnails6',
    './references/tags/community/thumbnails5',
    './references/tags/community/thumbnails4',
    './references/tags/community/thumbnails3',
  ],

  // Sampling temperature for generation - higher values increase output diversity. Combined with a
  // random seed per request (see generateThumbnail), this ensures regenerating a tag (after deleting
  // its existing output file) produces a genuinely different image rather than a near-identical repeat.
  temperature: 1.2,

  // Delay between requests, in milliseconds
  requestDelayMs: 1000,

  // Max images to generate in a single run - once reached, the run stops and leaves the rest for next
  // time. Useful for staying under a rate/quota limit, or for testing on a small batch.
  maxGenerationsPerRun: 999,

  // Tag name to start from in the tags list (case-insensitive) - everything before it is skipped.
  // Set to an empty string to start from the beginning of the list as normal.
  startTag: '',
};

// ======================================================================
// TYPES
// ======================================================================

type ReferencePart = { text: string } | { inlineData: { data: string; mimeType: string } };

// ======================================================================
// SETUP
// ======================================================================

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ======================================================================
// REFERENCE IMAGES
// ======================================================================

// Loads every image in a reference folder as inline base64 parts, each preceded by a text part naming
// the tag it's an example for (derived from its filename) - this lets the model associate style cues
// with that specific tag, rather than treating all references as one undifferentiated style blob.
function loadReferenceImages(referenceDir: string): ReferencePart[] {
  if (!fs.existsSync(referenceDir)) {
    console.error(chalk.red(`✗ Reference directory doesn't exist: ${referenceDir}`));
    process.exit(1);
  }

  const files = fs.readdirSync(referenceDir).filter((file) => /\.(png|jpe?g|webp)$/i.test(file));

  if (files.length === 0) {
    console.error(chalk.red(`✗ No reference images found in: ${referenceDir}`));
    process.exit(1);
  }

  return files.flatMap((file): ReferencePart[] => {
    const filePath = path.join(referenceDir, file);
    const data = fs.readFileSync(filePath).toString('base64');
    const ext = path.extname(file).slice(1).toLowerCase();
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const label = path.basename(file, path.extname(file)).replace(/-/g, ' ');

    return [{ text: `Reference image for the tag "${label}":` }, { inlineData: { data, mimeType } }];
  });
}

// Loads every reference tier up front, most references first
function loadReferenceTiers(): ReferencePart[][] {
  return CONFIG.referenceTierDirs.map((referenceDir) => {
    const referenceParts = loadReferenceImages(referenceDir);
    const imageCount = referenceParts.filter((part) => 'inlineData' in part).length;

    console.log(chalk.cyan(`▶ Loaded ${imageCount} reference image(s) from ${referenceDir}`));

    return referenceParts;
  });
}

// ======================================================================
// IMAGE GENERATION
// ======================================================================

// Generates a single thumbnail for a tag, conditioned on the given reference images, and writes it to
// outputPath cropped/resized to CONFIG.width x CONFIG.height. Throws if Gemini doesn't return an image.
async function generateThumbnail(tag: string, referenceParts: ReferencePart[], outputPath: string): Promise<void> {
  const prompt = CONFIG.prompt.replace('{{tag}}', tag);

  const response = await ai.models.generateContent({
    model: CONFIG.model,
    contents: [{ text: prompt }, ...referenceParts],
    config: {
      temperature: CONFIG.temperature,
      // Random per request so identical prompts (e.g. regenerating a deleted tag) don't reliably
      // reproduce the same output - omitting seed still allows repeats since it only nudges sampling.
      seed: Math.floor(Math.random() * 2 ** 31),
      imageConfig: {
        // Closest supported enum to the target 5:3 output - minimises the crop `sharp` then applies
        aspectRatio: '3:2',
      },
    },
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);

  if (!imagePart?.inlineData?.data) {
    const finishReason = response.candidates?.[0]?.finishReason;
    const textPart = response.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    const reason = finishReason || textPart || 'unknown';

    throw new Error(`No image returned in response (${reason})`);
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');

  await sharp(buffer).resize(CONFIG.width, CONFIG.height, { fit: 'cover' }).jpeg().toFile(outputPath);
}

// Generates a thumbnail for a single tag, retrying against progressively smaller reference tiers if
// a request fails. Returns true if any tier succeeded.
async function generateThumbnailWithRetries(
  tag: string,
  outputPath: string,
  referenceTiers: ReferencePart[][]
): Promise<{ succeeded: boolean; lastError?: Error }> {
  let lastError: Error | undefined;

  for (const [tierIndex, referenceParts] of referenceTiers.entries()) {
    try {
      await generateThumbnail(tag, referenceParts, outputPath);
      return { succeeded: true };
    } catch (error) {
      lastError = error as Error;

      const hasMoreTiers = tierIndex < referenceTiers.length - 1;
      if (hasMoreTiers) {
        console.log(chalk.yellow(`… ${tag}: ${lastError.message} (retrying with fewer references)`));
        await sleep(CONFIG.requestDelayMs);
      }
    }
  }

  return { succeeded: false, lastError };
}

// ======================================================================
// MAIN
// ======================================================================

// Applies CONFIG.startTag, returning the tag list to actually process (and logs what was skipped)
function getTagsToProcess(allTags: string[]): string[] {
  if (!CONFIG.startTag) {
    return allTags;
  }

  const startIndex = allTags.findIndex((tag) => tag.toLowerCase() === CONFIG.startTag.toLowerCase());

  if (startIndex === -1) {
    console.error(chalk.red(`✗ startTag "${CONFIG.startTag}" was not found in ${CONFIG.tagsFile}`));
    process.exit(1);
  }

  console.log(chalk.cyan(`▶ Starting from "${allTags[startIndex]}" (skipping ${startIndex} earlier tag(s))`));

  return allTags.slice(startIndex);
}

async function processTags(): Promise<void> {
  console.log(chalk.bgCyan(`# Generating tag thumbnails (${CONFIG.width}x${CONFIG.height})`));

  if (!process.env.GEMINI_API_KEY) {
    console.error(chalk.red('✗ GEMINI_API_KEY is not set in .env'));
    process.exit(1);
  }

  const allTags: string[] = JSON.parse(fs.readFileSync(CONFIG.tagsFile, 'utf-8'));
  const tags = getTagsToProcess(allTags);
  const referenceTiers = loadReferenceTiers();

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const tag of tags) {
    if (generated >= CONFIG.maxGenerationsPerRun) {
      console.log(chalk.cyan(`! Reached max of ${CONFIG.maxGenerationsPerRun} generations for this run, stopping`));
      break;
    }

    const outputPath = path.join(CONFIG.outputDir, `${slugifyTagName(tag)}.jpg`);

    // Never regenerate a tag that already has an output file
    if (fs.existsSync(outputPath)) {
      console.log(chalk.dim(`- ${tag} (already exists, skipping)`));
      skipped += 1;
      continue;
    }

    const { succeeded, lastError } = await generateThumbnailWithRetries(tag, outputPath, referenceTiers);

    if (succeeded) {
      generated += 1;
      console.log(chalk.green(`✓ ${tag}`));
    } else {
      failed += 1;
      console.error(chalk.red(`✗ ${tag}: ${lastError?.message}`));
    }

    await sleep(CONFIG.requestDelayMs);
  }

  console.log(chalk.bgCyan(`✓ Generated ${generated}, skipped ${skipped}, failed ${failed} (of ${tags.length} tags)`));

  const remaining = tags.length - skipped - generated;

  if (remaining > 0) {
    console.log(chalk.cyan(`! ${remaining} tag(s) remaining - run again to continue`));
  }
}

processTags().catch((error: Error) => {
  console.error(chalk.red(`✗ ${error.message}`));
  process.exit(1);
});
