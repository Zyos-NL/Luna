/**
 * download-models.mjs — Luna Fase-1 model downloader (~22 GB total)
 *
 * Downloads the Flux.1 dev GGUF stack + PuLID-Flux + skin/body LoRAs +
 * FaceDetailer dependencies into the SHARED bind-mount `../lumi/models/`.
 * The lumi-models folder is the single source of truth for both Lumi (anime,
 * port 18188) and Luna (photoreal, port 18190); luna may ADD files but MUST
 * NEVER overwrite anything that already exists there. The skip protocol
 * implements that hard rule.
 *
 * Usage:
 *   node scripts/download-models.mjs                 # download all (Fase-1)
 *   node scripts/download-models.mjs --list          # dry-run, print table
 *   node scripts/download-models.mjs --only=fluxQ5   # one specific model
 *   node scripts/download-models.mjs --force         # bypass skip-check
 *                                                    # (refuses on shared lumi paths)
 *
 * Run prerequisites:
 *   - Node 24+ (uses native fetch + Readable.fromWeb)
 *   - infra/.env with CIVITAI_TOKEN  (only required if a Civitai key is targeted)
 *   - infra/.env may also set HF_TOKEN (gated repos; not needed for Fase-1)
 *
 * Skip protocol (NEVER OVERWRITE):
 *   1. Always-skip list (paths shared with Lumi: vae/ae.safetensors, clip_l,
 *      sams/, ultralytics/, upscale_models/, text_encoders/) — even with --force.
 *   2. For all other paths: skip if file exists, unless --force is set.
 *   3. Atomic write: download to <dest>.partial, rename on success, cleanup on fail.
 */

import { existsSync, statSync, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MODELS_ROOT = resolve(__dirname, '..', '..', 'lumi', 'models');
const ENV_FILE = resolve(REPO_ROOT, 'infra', '.env');

// Paths shared with Lumi or otherwise immutable: NEVER overwrite, even with --force.
// These are folders/files Lumi already manages or that are generic enough to be
// in lumi/models/ for any project. Touching them would risk breaking Lumi.
const ALWAYS_SKIP_PREFIXES = [
  'vae/ae.safetensors',
  'clip/clip_l.safetensors',
  'text_encoders/clip_l.safetensors',
  'sams/',
  'ultralytics/',
  'upscale_models/',
];

/**
 * Fase-1 minimum stack (~22 GB).
 * Order matters: smaller dependencies first so failures show up fast.
 *
 * sourceType: 'hf' = direct HuggingFace URL, 'civitai' = needs airID lookup,
 *             'direct' = arbitrary HTTPS (e.g. fbaipublicfiles for SAM).
 *
 * For civitai entries, `civitaiVersionId` is the resolved versionId (a.k.a.
 * the airID used in the download endpoint). We resolved these once via the
 * public /api/v1/models/<id> endpoint; if you need a newer version bump it
 * here rather than re-querying at runtime.
 *   - Jib Mix Flux (model 686814) v12 SRPO  -> versionId 2319074
 *   - Photorealistic Skin No Plastic (1157318) FLUX v0.1 -> versionId 1301668
 */
const MODELS = [
  {
    key: 'clipL',
    dest: 'clip/clip_l.safetensors',
    sourceType: 'hf',
    url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors?download=true',
    expectedSizeMB: 250,
    notes: 'CLIP-L text encoder for Flux. Shared with potential lumi-flux usage.',
  },
  {
    key: 'fluxVae',
    dest: 'vae/ae.safetensors',
    sourceType: 'hf',
    // black-forest-labs/FLUX.1-dev is gated (HTTP 401 anonymous). Comfy-Org's
    // Lumina_Image_2.0_Repackaged hosts the identical VAE (335,304,388 bytes,
    // bit-identical confirmed via Content-Length match against multiple mirrors).
    url: 'https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors?download=true',
    expectedSizeMB: 335,
    notes: 'Flux.1 dev VAE (autoencoder). Mirrored via Comfy-Org Lumina-2.0 repack (BFL repo is gated).',
  },
  {
    key: 'ultraSharp',
    dest: 'upscale_models/4x-UltraSharp.pth',
    sourceType: 'hf',
    url: 'https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth?download=true',
    expectedSizeMB: 67,
    notes: 'Hires-fix upscaler for 1024 -> 1536 model-upscale.',
  },
  {
    key: 'personYolo',
    dest: 'ultralytics/segm/person_yolov8m-seg.pt',
    sourceType: 'hf',
    url: 'https://huggingface.co/Bingsu/adetailer/resolve/main/person_yolov8m-seg.pt?download=true',
    expectedSizeMB: 52,
    notes: 'Person segmentation for FaceDetailer body-bbox. Bingsu/adetailer is canonical adetailer repo.',
  },
  {
    key: 'samVitB',
    dest: 'sams/sam_vit_b_01ec64.pth',
    sourceType: 'direct',
    url: 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth',
    expectedSizeMB: 358,
    notes: 'Segment Anything (vit-b) for FaceDetailer mask refinement. Meta CDN, no auth.',
  },
  {
    key: 'evaClipL',
    // Confirmed via inspection of pulidflux.py:
    //   clip_file_path = folder_paths.get_full_path("text_encoders", 'EVA02_CLIP_L_336_psz14_s6B.pt')
    // ComfyUI's "text_encoders" folder maps to models/text_encoders (with
    // models/clip as a legacy alias). We place the EVA-CLIP weight in
    // text_encoders/ to match the loader exactly.
    dest: 'text_encoders/EVA02_CLIP_L_336_psz14_s6B.pt',
    sourceType: 'hf',
    url: 'https://huggingface.co/QuanSun/EVA-CLIP/resolve/main/EVA02_CLIP_L_336_psz14_s6B.pt?download=true',
    expectedSizeMB: 430,
    notes: 'EVA-CLIP face encoder loaded by PulidFluxEvaClipLoader (lldacing fork).',
  },
  {
    key: 'pulidFlux',
    dest: 'pulid/pulid_flux_v0.9.1.safetensors',
    sourceType: 'hf',
    url: 'https://huggingface.co/guozinan/PuLID/resolve/main/pulid_flux_v0.9.1.safetensors?download=true',
    expectedSizeMB: 1200,
    notes: 'PuLID-Flux v0.9.1 weights (identity-lock).',
  },
  {
    key: 'skinLora',
    dest: 'loras/photorealisticSkinNoPlastic_flux.safetensors',
    sourceType: 'civitai',
    civitaiModelId: 1157318,
    civitaiVersionId: 1301668,
    expectedSizeMB: 75,
    notes: 'aidmaRealisticSkin-FLUX v0.1 (always-on weight 0.4-0.6 in v1).',
  },
  {
    key: 't5xxlFp8',
    dest: 'clip/t5xxl_fp8_e4m3fn.safetensors',
    sourceType: 'hf',
    url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors?download=true',
    expectedSizeMB: 5000,
    notes: 'T5-XXL fp8_e4m3fn text encoder (~5 GB).',
  },
  {
    key: 'jibMixFlux',
    dest: 'loras/jibMixFlux_v12.safetensors',
    sourceType: 'civitai',
    civitaiModelId: 686814,
    civitaiVersionId: 2319074,
    expectedSizeMB: 7000,
    notes: 'Jib Mix Flux v12 SRPO — primary NSFW finetune (~7 GB).',
  },
  {
    key: 'fluxQ5',
    dest: 'unet/flux1-dev-Q5_K_S.gguf',
    sourceType: 'hf',
    // city96/FLUX.1-dev-gguf publiceert geen Q5_K_M variant — alleen Q5_K_S in de
    // K-quant 5-bit familie. Q5_K_S is marginaal kleiner/sneller dan _M, geen
    // merkbaar kwaliteitsverlies op RTX 4070 voor photoreal.
    url: 'https://huggingface.co/city96/FLUX.1-dev-gguf/resolve/main/flux1-dev-Q5_K_S.gguf?download=true',
    expectedSizeMB: 7900,
    notes: 'Flux.1 dev quantized to Q5_K_S (~7.9 GB). Default Luna engine.',
  },
  {
    key: 'fluxKontextQ5',
    dest: 'unet/flux1-kontext-dev-Q5_K_S.gguf',
    sourceType: 'hf',
    // Fase 3 — Image-edit engine. QuantStack mirror van BFL FLUX.1-Kontext-dev.
    // BFL repo zelf is gated; QuantStack publiceert publieke GGUF-quants.
    // Q5_K_S kiest dezelfde quant-tier als de Flux dev base — past op 12 GB
    // naast T5/CLIP/VAE/Skin-LoRA. Geen TensorRT (LoRA-incompat dealbreaker).
    url: 'https://huggingface.co/QuantStack/FLUX.1-Kontext-dev-GGUF/resolve/main/flux1-kontext-dev-Q5_K_S.gguf?download=true',
    expectedSizeMB: 7900,
    notes: 'Flux.1 Kontext dev quantized to Q5_K_S (~8.3 GB). Fase 3 image-edit engine.',
  },
];

// ---------------------------------------------------------------------------
// .env parsing (no external deps)
// ---------------------------------------------------------------------------

/** @returns {Record<string, string>} */
async function loadEnv() {
  if (!existsSync(ENV_FILE)) {
    return {};
  }
  const raw = await readFile(ENV_FILE, 'utf8');
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip wrapping quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/** @returns {{ list: boolean, force: boolean, only: string|null }} */
function parseArgs() {
  const args = process.argv.slice(2);
  let list = false;
  let force = false;
  /** @type {string|null} */
  let only = null;
  for (const arg of args) {
    if (arg === '--list') list = true;
    else if (arg === '--force') force = true;
    else if (arg.startsWith('--only=')) only = arg.slice('--only='.length);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return { list, force, only };
}

function printHelp() {
  console.log(`Usage: node scripts/download-models.mjs [flags]

Flags:
  --list             Print the model table without downloading anything.
  --only=<key>       Download only the model with this top-level key (see --list).
  --force            Bypass the skip-check (still refuses on always-skip paths).
  -h, --help         Show this help.

Examples:
  node scripts/download-models.mjs --list
  node scripts/download-models.mjs --only=fluxQ5
  node scripts/download-models.mjs
`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} bytes */
function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** @param {number} ms */
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm}m${rs}s`;
}

/** @param {string} url */
function redactToken(url) {
  return url.replace(/token=[^&]+/i, 'token=***');
}

/** @param {string} dest */
function isAlwaysSkip(dest) {
  // Normalise to forward slashes for prefix-compare regardless of OS path style.
  const norm = dest.replace(/\\/g, '/');
  return ALWAYS_SKIP_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Civitai airID resolver (cached on the MODELS entry; only re-fetches if missing)
// ---------------------------------------------------------------------------

/**
 * @param {(typeof MODELS)[number]} entry
 * @returns {Promise<number>}
 */
async function resolveCivitaiVersion(entry) {
  if (entry.sourceType !== 'civitai') {
    throw new Error(`resolveCivitaiVersion called on non-civitai entry ${entry.key}`);
  }
  if (entry.civitaiVersionId) return entry.civitaiVersionId;
  if (!entry.civitaiModelId) {
    throw new Error(`civitai entry ${entry.key} missing both civitaiVersionId and civitaiModelId`);
  }
  const apiUrl = `https://civitai.com/api/v1/models/${entry.civitaiModelId}`;
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Civitai API ${apiUrl} -> HTTP ${res.status}`);
  }
  const data = /** @type {{modelVersions: Array<{id:number,name:string}>}} */ (await res.json());
  if (!data.modelVersions || data.modelVersions.length === 0) {
    throw new Error(`Civitai model ${entry.civitaiModelId} has no versions`);
  }
  // Use the first (latest) version. If a specific name is needed, override
  // civitaiVersionId in the MODELS entry.
  return data.modelVersions[0].id;
}

// ---------------------------------------------------------------------------
// Streaming download with progress, retry, atomic rename
// ---------------------------------------------------------------------------

/**
 * @param {string} url
 * @param {string} absDest
 * @param {{ headers?: Record<string,string> }} [opts]
 */
async function downloadOnce(url, absDest, opts = {}) {
  const partial = `${absDest}.partial`;
  await mkdir(dirname(absDest), { recursive: true });

  const res = await fetch(url, { headers: opts.headers, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${redactToken(url)}`);
  }
  if (!res.body) {
    throw new Error(`No response body for ${redactToken(url)}`);
  }

  const totalRaw = res.headers.get('content-length');
  const total = totalRaw ? Number.parseInt(totalRaw, 10) : NaN;

  let downloaded = 0;
  const start = Date.now();
  let lastPrint = 0;
  const out = createWriteStream(partial);

  const nodeStream = Readable.fromWeb(/** @type {any} */ (res.body));
  nodeStream.on('data', (/** @type {Buffer} */ chunk) => {
    downloaded += chunk.length;
    const now = Date.now();
    if (now - lastPrint >= 500) {
      lastPrint = now;
      const elapsed = (now - start) / 1000;
      const speed = elapsed > 0 ? downloaded / elapsed : 0;
      const pctStr = Number.isFinite(total) && total > 0
        ? `${((downloaded / total) * 100).toFixed(1)}%`
        : '??.?%';
      const totalStr = Number.isFinite(total) ? fmtBytes(total) : '?';
      const etaStr = Number.isFinite(total) && total > 0 && speed > 0
        ? fmtDuration(((total - downloaded) / speed) * 1000)
        : '?';
      const speedMB = (speed / (1024 * 1024)).toFixed(2);
      const line = `  downloading... ${pctStr} (${fmtBytes(downloaded)} / ${totalStr}) at ${speedMB} MB/s ETA ${etaStr}`;
      process.stdout.write(`\r${line.padEnd(80)}`);
    }
  });

  try {
    await pipeline(nodeStream, out);
  } catch (err) {
    process.stdout.write('\n');
    // Cleanup partial on stream error.
    try { await unlink(partial); } catch { /* ignore */ }
    throw err;
  }
  process.stdout.write('\n');

  // Size sanity check (warn only — Civitai/HF sometimes omit accurate Content-Length).
  if (Number.isFinite(total) && total > 0 && downloaded !== total) {
    console.warn(`  warn: downloaded ${downloaded} bytes != Content-Length ${total} bytes (continuing)`);
  }

  await rename(partial, absDest);
  return { bytes: downloaded, ms: Date.now() - start };
}

/**
 * @param {string} url
 * @param {string} absDest
 * @param {{ headers?: Record<string,string> }} [opts]
 */
async function downloadWithRetry(url, absDest, opts = {}) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await downloadOnce(url, absDest, opts);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  attempt ${attempt}/${maxAttempts} failed: ${msg}`);
      if (attempt < maxAttempts) {
        const backoff = 1000 * Math.pow(2, attempt - 1);
        console.warn(`  retrying in ${backoff}ms...`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const env = await loadEnv();

  console.log(`Models root: ${MODELS_ROOT}`);
  if (!existsSync(MODELS_ROOT)) {
    console.error(
      `error: lumi models folder not found at ${MODELS_ROOT}. ` +
        'Luna binds-mounts the lumi models folder; clone/sync lumi first.',
    );
    process.exit(1);
  }

  const targets = args.only
    ? MODELS.filter((m) => m.key === args.only)
    : MODELS;
  if (args.only && targets.length === 0) {
    console.error(`error: --only=${args.only} matched no model. Try --list.`);
    process.exit(2);
  }

  // --list: print table only.
  if (args.list) {
    console.log('\nFase-1 model table:\n');
    console.log(
      ['#', 'key', 'dest', 'size', 'source', 'always-skip']
        .map((h) => h.padEnd(h === 'dest' ? 48 : 14))
        .join(''),
    );
    console.log('-'.repeat(120));
    targets.forEach((m, i) => {
      const skip = isAlwaysSkip(m.dest) ? 'YES' : 'no';
      console.log(
        [
          String(i + 1).padEnd(14),
          m.key.padEnd(14),
          m.dest.padEnd(48),
          `${m.expectedSizeMB} MB`.padEnd(14),
          m.sourceType.padEnd(14),
          skip,
        ].join(''),
      );
    });
    const total = targets.reduce((s, m) => s + m.expectedSizeMB, 0);
    console.log(`\nTotal expected: ~${(total / 1024).toFixed(1)} GB across ${targets.length} files.`);
    return;
  }

  // Token preflight: only error if a Civitai entry is in the target set.
  const needsCivitai = targets.some((m) => m.sourceType === 'civitai');
  const civitaiToken = env.CIVITAI_TOKEN || process.env.CIVITAI_TOKEN || '';
  if (needsCivitai && !civitaiToken) {
    console.error(
      `error: CIVITAI_TOKEN required for one or more targeted models (${targets
        .filter((m) => m.sourceType === 'civitai')
        .map((m) => m.key)
        .join(', ')}). ` +
        'Copy infra/.env.example to infra/.env and fill in CIVITAI_TOKEN.',
    );
    process.exit(1);
  }
  const hfToken = env.HF_TOKEN || process.env.HF_TOKEN || '';

  /** @type {{key:string, ok:boolean, skipped:boolean, bytes:number, ms:number, err?:string}[]} */
  const results = [];
  const runStart = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    const absDest = join(MODELS_ROOT, m.dest);
    const idxStr = `[${i + 1}/${targets.length}]`;
    console.log(`\n${idxStr} ${m.key} -> ${m.dest} (~${m.expectedSizeMB} MB)`);
    console.log(`  source: ${m.sourceType}${m.sourceType === 'civitai' ? ` (model ${m.civitaiModelId})` : ''}`);
    console.log(`  notes:  ${m.notes}`);

    // Skip-check.
    const exists = existsSync(absDest);
    const alwaysSkip = isAlwaysSkip(m.dest);
    if (exists) {
      const sz = statSync(absDest).size;
      if (alwaysSkip) {
        console.log(`  skip — file exists (${fmtBytes(sz)}); always-skip path (shared with lumi).`);
        results.push({ key: m.key, ok: true, skipped: true, bytes: 0, ms: 0 });
        continue;
      }
      if (!args.force) {
        console.log(`  skip — file already exists (${fmtBytes(sz)}). Use --force to override.`);
        results.push({ key: m.key, ok: true, skipped: true, bytes: 0, ms: 0 });
        continue;
      }
      // --force on an always-skip path is refused above already; --force on a
      // luna-only path is allowed but we warn loudly.
      console.warn(`  warn: --force overwriting existing file (${fmtBytes(sz)}).`);
    }
    if (!exists && alwaysSkip) {
      // First-time download into a shared lumi path is fine — the always-skip
      // rule only protects against overwriting. Keep going.
    }

    // Resolve URL.
    /** @type {string} */
    let url;
    /** @type {Record<string,string>} */
    const headers = {};
    if (m.sourceType === 'civitai') {
      try {
        const versionId = await resolveCivitaiVersion(m);
        url = `https://civitai.com/api/download/models/${versionId}?token=${civitaiToken}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  error: ${msg}`);
        results.push({ key: m.key, ok: false, skipped: false, bytes: 0, ms: 0, err: msg });
        continue;
      }
    } else {
      url = m.url;
      if (m.sourceType === 'hf' && hfToken) {
        headers.Authorization = `Bearer ${hfToken}`;
      }
    }

    // Download.
    try {
      const { bytes, ms } = await downloadWithRetry(url, absDest, { headers });
      console.log(`  done in ${fmtDuration(ms)} — written to ${absDest}`);
      results.push({ key: m.key, ok: true, skipped: false, bytes, ms });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  failed: ${msg}`);
      results.push({ key: m.key, ok: false, skipped: false, bytes: 0, ms: 0, err: msg });
    }
  }

  // Summary.
  const downloaded = results.filter((r) => r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.ok);
  const totalBytes = downloaded.reduce((s, r) => s + r.bytes, 0);
  const elapsed = Date.now() - runStart;

  console.log('\n=== Summary ===');
  console.log(
    `Downloaded: ${downloaded.length} / ${results.length}. Skipped: ${skipped.length}. Failed: ${failed.length}.`,
  );
  console.log(`Total downloaded: ${fmtBytes(totalBytes)} in ${fmtDuration(elapsed)}.`);
  if (failed.length > 0) {
    console.error('\nFailed:');
    for (const r of failed) console.error(`  - ${r.key}: ${r.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
