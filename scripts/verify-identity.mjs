/**
 * verify-identity.mjs — InsightFace ArcFace cosine-similarity QA
 *
 * Compares an output image's primary face against a character's identity.png
 * using the buffalo_l face-recognition model (already installed in luna-comfyui
 * as a PuLID-Flux dependency: insightface 0.7.3). Threshold per CLAUDE.md hard
 * rule: cosine ≥0.65 = PASS, 0.50–0.65 = WARN, <0.50 = FAIL.
 *
 * Usage:
 *   node scripts/verify-identity.mjs --identity <path> --output <path>
 *   node scripts/verify-identity.mjs --character <id> --output <path>
 *
 * Examples:
 *   node scripts/verify-identity.mjs \
 *     --identity C:\Users\Clips\repos\lumi\models\luna-characters\sofia\identity.png \
 *     --output   C:\Users\Clips\repos\luna\outputs\sofia_2026-05-01.png
 *   node scripts/verify-identity.mjs --character sofia --output <path>
 *
 * Exit codes:
 *   0 = PASS  (cosine ≥0.65)
 *   1 = WARN  (cosine 0.50–0.65)
 *   2 = FAIL  (cosine <0.50)
 *   3 = ERROR (file missing, no face detected, container down, etc.)
 *
 * Architecture:
 *   - Container `luna-comfyui` is required (uses its insightface + cv2 + numpy).
 *   - Both files must live under a bind-mounted host folder so the container
 *     can read them. The two relevant mounts (per infra/docker-compose.yml):
 *       host  C:\Users\Clips\repos\lumi\models   →  /root/ComfyUI/models
 *       host  C:\Users\Clips\repos\luna\outputs  →  /root/ComfyUI/output
 *   - hostToContainer() maps Windows host paths to those container paths.
 *   - The Python helper is written via `docker exec ... bash -c "cat > ..."`
 *     and invoked with the two container paths. Result lines are parsed as
 *     `KEY=value` for robustness.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// ── CLI args (no external deps) ────────────────────────────────────────────

const args = process.argv.slice(2).reduce((acc, raw) => {
  const [k, v] = raw.replace(/^--/, '').split('=');
  acc[k] = v ?? true;
  return acc;
}, {});

if (args.help || args.h) {
  console.log(
    'Usage:\n' +
    '  node scripts/verify-identity.mjs --identity <path> --output <path>\n' +
    '  node scripts/verify-identity.mjs --character <id>  --output <path>\n',
  );
  process.exit(0);
}

// Support `--character sofia --output <p>` AND `--identity <p> --output <p>`.
function resolveIdentityPath() {
  if (args.identity && typeof args.identity === 'string') {
    return resolve(args.identity);
  }
  if (args.character && typeof args.character === 'string') {
    // Fase-2 convention (folder does not exist yet — caller will get a clear
    // "file not found" error if the character has no identity.png on disk).
    const guess = resolve(
      'C:/Users/Clips/repos/lumi/models/luna-characters',
      args.character,
      'identity.png',
    );
    return guess;
  }
  console.error('ERROR: must pass either --identity <path> or --character <id>');
  process.exit(3);
}

const identityHost = resolveIdentityPath();
const outputHost = args.output && typeof args.output === 'string' ? resolve(args.output) : null;

if (!outputHost) {
  console.error('ERROR: missing --output <path>');
  process.exit(3);
}

if (!existsSync(identityHost)) {
  console.error(`ERROR: identity not found: ${identityHost}`);
  if (args.character) {
    console.error(`(Expected at lumi/models/luna-characters/${args.character}/identity.png — Fase-2 path.)`);
  }
  process.exit(3);
}

if (!existsSync(outputHost)) {
  console.error(`ERROR: output not found: ${outputHost}`);
  process.exit(3);
}

// ── Host → container path mapping ──────────────────────────────────────────

/**
 * Map a Windows host path to its corresponding container path, based on the
 * two bind mounts configured in infra/docker-compose.yml. Throws if the path
 * lies outside both mounts (the container could not reach it).
 */
function hostToContainer(hostPath) {
  const norm = hostPath.replaceAll(sep, '/');
  const mounts = [
    { host: 'C:/Users/Clips/repos/lumi/models',  container: '/root/ComfyUI/models' },
    { host: 'C:/Users/Clips/repos/luna/outputs', container: '/root/ComfyUI/output' },
  ];
  for (const m of mounts) {
    // Case-insensitive prefix match — Windows paths are case-insensitive.
    if (norm.toLowerCase().startsWith(m.host.toLowerCase())) {
      return m.container + norm.slice(m.host.length);
    }
  }
  throw new Error(
    `Path is not under a bind-mounted folder; container cannot read it:\n  ${hostPath}\n` +
    `Expected prefix: lumi/models or luna/outputs.`,
  );
}

let identityCt, outputCt;
try {
  identityCt = hostToContainer(identityHost);
  outputCt = hostToContainer(outputHost);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(3);
}

// ── Container check ────────────────────────────────────────────────────────

function dockerExec(...cmd) {
  return spawnSync('docker', cmd, { encoding: 'utf8' });
}

const psCheck = dockerExec('ps', '--filter', 'name=^/luna-comfyui$', '--format', '{{.Names}}');
if (psCheck.status !== 0 || !psCheck.stdout.includes('luna-comfyui')) {
  console.error('ERROR: container `luna-comfyui` is not running. Start it with `Luna.bat` first.');
  process.exit(3);
}

// ── Container-side Python helper ───────────────────────────────────────────

// We write the script via `docker exec ... bash -c 'cat > /tmp/verify_identity.py'`
// using a heredoc, then run it. This is more readable than `python -c` with
// nested escapes. Key contract: print KEY=value lines so Node can parse robustly.
const PY = `
import sys, os, math
import cv2
import numpy as np

# Quiet onnxruntime/insightface chatter so KEY=value parsing stays clean.
os.environ.setdefault("ORT_LOGGING_LEVEL", "3")

def emit(k, v):
    print(f"{k}={v}", flush=True)

def fail(msg):
    emit("STATUS", "ERROR")
    emit("ERROR", msg)
    sys.exit(3)

if len(sys.argv) != 3:
    fail("usage: verify_identity.py <identity> <output>")
ident_path, out_path = sys.argv[1], sys.argv[2]

for p in (ident_path, out_path):
    if not os.path.isfile(p):
        fail(f"file not found in container: {p}")

try:
    from insightface.app import FaceAnalysis
except Exception as e:
    fail(f"insightface import failed: {e}")

# buffalo_l = default face-recognition pack; downloads to ~/.insightface on
# first run. Provider order: CUDA when available, else CPU.
providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
app = FaceAnalysis(name="buffalo_l", providers=providers)
app.prepare(ctx_id=0, det_size=(640, 640))

def embed(path, label):
    img = cv2.imread(path)
    if img is None:
        fail(f"cv2 could not read {label}: {path}")
    faces = app.get(img)
    if len(faces) == 0:
        fail(f"no face detected in {label}: {path}")
    if len(faces) > 1:
        # Pick the largest bbox face but warn the caller — multi-face is
        # ambiguous for identity QA.
        emit("WARN_MULTIFACE_" + label.upper(), len(faces))
        faces.sort(key=lambda f: (f.bbox[2]-f.bbox[0]) * (f.bbox[3]-f.bbox[1]), reverse=True)
    f = faces[0]
    return f.normed_embedding  # already L2-normalised, 512-d

a = embed(ident_path, "identity")
b = embed(out_path, "output")
cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
if math.isnan(cos):
    fail("cosine returned NaN")
emit("COSINE", f"{cos:.4f}")
emit("STATUS", "OK")
`;

// Write helper script into the container via stdin, then exec it.
const writeRes = spawnSync(
  'docker',
  ['exec', '-i', 'luna-comfyui', 'bash', '-lc', 'cat > /tmp/verify_identity.py'],
  { input: PY, encoding: 'utf8' },
);
if (writeRes.status !== 0) {
  console.error('ERROR: failed to write helper into container.');
  console.error(writeRes.stderr);
  process.exit(3);
}

const run = spawnSync(
  'docker',
  ['exec', 'luna-comfyui', 'python', '/tmp/verify_identity.py', identityCt, outputCt],
  { encoding: 'utf8' },
);

// ── Parse KEY=value output ─────────────────────────────────────────────────

const parsed = {};
for (const line of (run.stdout || '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) parsed[m[1]] = m[2];
}

if (parsed.STATUS === 'ERROR' || run.status === 3) {
  console.error('ERROR:', parsed.ERROR || run.stderr || 'unknown');
  process.exit(3);
}
if (run.status !== 0 && parsed.STATUS !== 'OK') {
  console.error('ERROR: container script exited with non-zero status.');
  console.error(run.stderr);
  process.exit(3);
}

const cosine = Number(parsed.COSINE);
if (!Number.isFinite(cosine)) {
  console.error('ERROR: could not parse COSINE from container output.');
  console.error(run.stdout);
  process.exit(3);
}

let status, exit;
if (cosine >= 0.65) { status = 'PASS (≥0.65)'; exit = 0; }
else if (cosine >= 0.50) { status = 'WARN (0.50–0.65)'; exit = 1; }
else { status = 'FAIL (<0.50)'; exit = 2; }

console.log(`Identity:    ${identityHost}`);
console.log(`Output:      ${outputHost}`);
console.log(`Similarity:  ${cosine.toFixed(4)}`);
console.log(`Status:      ${status}`);
if (parsed.WARN_MULTIFACE_IDENTITY) {
  console.log(`Note:        identity image has ${parsed.WARN_MULTIFACE_IDENTITY} faces — used largest`);
}
if (parsed.WARN_MULTIFACE_OUTPUT) {
  console.log(`Note:        output image has ${parsed.WARN_MULTIFACE_OUTPUT} faces — used largest`);
}

process.exit(exit);
