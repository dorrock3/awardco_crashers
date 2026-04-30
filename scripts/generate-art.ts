/**
 * Generate art assets via OpenAI's DALL·E 3 API.
 *
 * Usage:
 *   npm run art             # generate every character + background that's missing
 *   npm run art -- hero-red # only this id (matches characters or backgrounds)
 *   npm run art -- --force  # re-generate even if file exists
 *   npm run art -- --quality=standard   # cheaper ($0.04/image vs $0.08 HD)
 *   npm run art -- --backgrounds-only   # skip characters
 *   npm run art -- --characters-only    # skip backgrounds
 *
 * Output:
 *   public/assets/sprites/<character-id>/full.png   (cut into parts manually)
 *   public/assets/backgrounds/<bg-id>.png
 *
 * Cost (HD default): 7 chars + 6 bgs = 13 images x $0.08 = ~$1.04 per full run.
 *
 * Requires OPENAI_API_KEY in .env (copy from .env.example).
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKGROUNDS, CHARACTERS, buildBackgroundPrompt, buildCharacterPrompt
} from './prompts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

interface CliOpts {
  ids: Set<string>;
  force: boolean;
  quality: 'standard' | 'hd';
  charactersOnly: boolean;
  backgroundsOnly: boolean;
}

function parseArgs(): CliOpts {
  const opts: CliOpts = {
    ids: new Set<string>(),
    force: false,
    quality: 'hd',
    charactersOnly: false,
    backgroundsOnly: false
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--force') opts.force = true;
    else if (arg === '--characters-only') opts.charactersOnly = true;
    else if (arg === '--backgrounds-only') opts.backgroundsOnly = true;
    else if (arg.startsWith('--quality=')) {
      const q = arg.split('=')[1];
      if (q !== 'standard' && q !== 'hd') {
        throw new Error(`--quality must be standard or hd (got ${q})`);
      }
      opts.quality = q;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      opts.ids.add(arg);
    }
  }
  return opts;
}

/** Minimal .env loader so we don't pull a dependency. Only reads KEY=value lines. */
async function loadEnv(): Promise<void> {
  const path = resolve(REPO_ROOT, '.env');
  try {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(path, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // .env optional — fall through and rely on existing env vars
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

interface GenerateOptions {
  prompt: string;
  size: '1024x1024' | '1792x1024' | '1024x1792';
  quality: 'standard' | 'hd';
}

/** Calls DALL·E 3 and returns the PNG bytes for one image. */
async function generateImage(opts: GenerateOptions, apiKey: string): Promise<Buffer> {
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: opts.prompt,
      size: opts.size,
      quality: opts.quality,
      n: 1,
      response_format: 'b64_json'
    })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${text}`);
  }
  const json = await resp.json() as { data: Array<{ b64_json: string }> };
  const b64 = json.data[0]?.b64_json;
  if (!b64) throw new Error('No b64_json in response');
  return Buffer.from(b64, 'base64');
}

async function writePng(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function main(): Promise<void> {
  const opts = parseArgs();
  await loadEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your-key-here') {
    console.error('OPENAI_API_KEY not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }

  const targets: Array<{ kind: 'char' | 'bg'; id: string; outPath: string; prompt: string; size: GenerateOptions['size'] }> = [];

  if (!opts.backgroundsOnly) {
    for (const c of CHARACTERS) {
      if (opts.ids.size && !opts.ids.has(c.id)) continue;
      targets.push({
        kind: 'char',
        id: c.id,
        outPath: resolve(REPO_ROOT, 'public/assets/sprites', c.id, 'full.png'),
        prompt: buildCharacterPrompt(c),
        size: '1024x1024'
      });
    }
  }
  if (!opts.charactersOnly) {
    for (const b of BACKGROUNDS) {
      if (opts.ids.size && !opts.ids.has(b.id)) continue;
      targets.push({
        kind: 'bg',
        id: b.id,
        outPath: resolve(REPO_ROOT, 'public/assets/backgrounds', `${b.id}.png`),
        prompt: buildBackgroundPrompt(b),
        size: '1792x1024'
      });
    }
  }

  if (targets.length === 0) {
    console.error('No targets selected. Check id filter or flags.');
    process.exit(1);
  }

  const costPer = opts.quality === 'hd' ? 0.08 : 0.04;
  console.log(`About to generate ${targets.length} image(s) at ${opts.quality} quality.`);
  console.log(`Estimated cost: ~$${(targets.length * costPer).toFixed(2)} USD`);
  console.log(`Output root: ${REPO_ROOT}\\public\\assets`);
  console.log('');

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of targets) {
    if (!opts.force && await fileExists(t.outPath)) {
      console.log(`[skip]  ${t.id} (exists; use --force to overwrite)`);
      skipped++;
      continue;
    }
    process.stdout.write(`[gen]   ${t.id} ... `);
    try {
      const bytes = await generateImage({ prompt: t.prompt, size: t.size, quality: opts.quality }, apiKey);
      await writePng(t.outPath, bytes);
      console.log(`OK (${bytes.length} bytes)`);
      succeeded++;
    } catch (err) {
      console.log(`FAIL`);
      console.error(`        ${(err as Error).message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Done. ${succeeded} generated, ${skipped} skipped, ${failed} failed.`);
  if (succeeded > 0) {
    console.log('');
    console.log('Next steps:');
    console.log('  1. Open each generated image in Photoshop/Krita/Photopea.');
    console.log('  2. Cut into named layers (torso, head, arm_l, arm_r, leg_l, leg_r).');
    console.log('  3. Export each layer as a transparent PNG into the same folder.');
    console.log('  4. Copy rig.json template from docs/art-pipeline.md.');
    console.log('  5. Reload the dev server — assets will replace placeholders.');
  }
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
