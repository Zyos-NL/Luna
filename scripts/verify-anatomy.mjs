/**
 * verify-anatomy.mjs — YOLO-pose COCO-17 keypoint count QA
 *
 * Runs ultralytics yolo11n-pose on an output image and counts how many of the
 * 17 COCO keypoints are visible (confidence ≥0.5). Per CLAUDE.md hard rule:
 *   ≥12 visible = PASS, 8–11 = WARN, <8 = FAIL.
 *
 * Usage:
 *   node scripts/verify-anatomy.mjs --output <path>
 *
 * Exit codes:
 *   0 = PASS (≥12 keypoints visible)
 *   1 = WARN (8–11)
 *   2 = FAIL (<8)
 *   3 = ERROR (file missing, container down, model download failed, …)
 *
 * Container deps:
 *   `ultralytics` is already installed as a controlnet_aux dependency. The
 *   pose model `yolo11n-pose.pt` (~6 MB) auto-downloads on first run into
 *   the container's working dir — no pollution of lumi/models.
 *
 * Container path mapping (host → container, per docker-compose.yml):
 *   C:\Users\Clips\repos\lumi\models   →  /root/ComfyUI/models
 *   C:\Users\Clips\repos\luna\outputs  →  /root/ComfyUI/output
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// ── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2).reduce((acc, raw) => {
  const [k, v] = raw.replace(/^--/, '').split('=');
  acc[k] = v ?? true;
  return acc;
}, {});

if (args.help || args.h || !args.output) {
  console.log('Usage: node scripts/verify-anatomy.mjs --output <path>');
  process.exit(args.help || args.h ? 0 : 3);
}

const outputHost = resolve(args.output);
if (!existsSync(outputHost)) {
  console.error(`ERROR: output not found: ${outputHost}`);
  process.exit(3);
}

// ── Host → container path mapping ──────────────────────────────────────────

function hostToContainer(hostPath) {
  const norm = hostPath.replaceAll(sep, '/');
  const mounts = [
    { host: 'C:/Users/Clips/repos/lumi/models',  container: '/root/ComfyUI/models' },
    { host: 'C:/Users/Clips/repos/luna/outputs', container: '/root/ComfyUI/output' },
  ];
  for (const m of mounts) {
    if (norm.toLowerCase().startsWith(m.host.toLowerCase())) {
      return m.container + norm.slice(m.host.length);
    }
  }
  throw new Error(
    `Path is not under a bind-mounted folder; container cannot read it:\n  ${hostPath}`,
  );
}

let outputCt;
try { outputCt = hostToContainer(outputHost); }
catch (e) { console.error(`ERROR: ${e.message}`); process.exit(3); }

// ── Container check ────────────────────────────────────────────────────────

const psCheck = spawnSync(
  'docker',
  ['ps', '--filter', 'name=^/luna-comfyui$', '--format', '{{.Names}}'],
  { encoding: 'utf8' },
);
if (psCheck.status !== 0 || !psCheck.stdout.includes('luna-comfyui')) {
  console.error('ERROR: container `luna-comfyui` is not running. Start it with `Luna.bat` first.');
  process.exit(3);
}

// ── Container-side Python helper ───────────────────────────────────────────

const COCO_17 = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

const PY = `
import sys, os, json
os.environ.setdefault("YOLO_VERBOSE", "false")

def emit(k, v):
    print(f"{k}={v}", flush=True)

def fail(msg):
    emit("STATUS", "ERROR")
    emit("ERROR", msg)
    sys.exit(3)

if len(sys.argv) != 2:
    fail("usage: verify_anatomy.py <output>")
out_path = sys.argv[1]
if not os.path.isfile(out_path):
    fail(f"file not found in container: {out_path}")

try:
    from ultralytics import YOLO
except Exception as e:
    fail(f"ultralytics import failed: {e}")

# yolo11n-pose.pt = ~6 MB nano pose model. Auto-downloads on first run.
try:
    model = YOLO("yolo11n-pose.pt")
except Exception as e:
    fail(f"YOLO model load/download failed: {e}")

results = model(out_path, verbose=False)
if not results or results[0].keypoints is None:
    fail("no keypoints returned by YOLO")

kp = results[0].keypoints
# Pick the highest-confidence person if multiple were detected.
if kp.conf is None or len(kp.conf) == 0:
    fail("no person detected")

import numpy as np
confs = kp.conf.cpu().numpy()  # shape (n_people, 17)
person_idx = int(np.argmax(confs.mean(axis=1)))
person = confs[person_idx]
visible_mask = (person >= 0.5).tolist()
visible_count = int(sum(visible_mask))
emit("VISIBLE", visible_count)
emit("MASK", json.dumps(visible_mask))
emit("PEOPLE", confs.shape[0])
emit("STATUS", "OK")
`;

const writeRes = spawnSync(
  'docker',
  ['exec', '-i', 'luna-comfyui', 'bash', '-lc', 'cat > /tmp/verify_anatomy.py'],
  { input: PY, encoding: 'utf8' },
);
if (writeRes.status !== 0) {
  console.error('ERROR: failed to write helper into container.');
  console.error(writeRes.stderr);
  process.exit(3);
}

const run = spawnSync(
  'docker',
  ['exec', 'luna-comfyui', 'python', '/tmp/verify_anatomy.py', outputCt],
  { encoding: 'utf8' },
);

// ── Parse + report ─────────────────────────────────────────────────────────

const parsed = {};
for (const line of (run.stdout || '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) parsed[m[1]] = m[2];
}

if (parsed.STATUS === 'ERROR') {
  console.error('ERROR:', parsed.ERROR || 'unknown');
  process.exit(3);
}
if (run.status !== 0 && parsed.STATUS !== 'OK') {
  console.error('ERROR: container script exited with non-zero status.');
  console.error(run.stderr);
  process.exit(3);
}

const visible = Number(parsed.VISIBLE);
const people = Number(parsed.PEOPLE);
let mask = [];
try { mask = JSON.parse(parsed.MASK || '[]'); } catch { /* ignore */ }

if (!Number.isFinite(visible)) {
  console.error('ERROR: could not parse VISIBLE from container output.');
  console.error(run.stdout);
  process.exit(3);
}

let status, exit;
if (visible >= 12) { status = 'PASS (≥12)'; exit = 0; }
else if (visible >= 8) { status = 'WARN (8–11)'; exit = 1; }
else { status = 'FAIL (<8)'; exit = 2; }

console.log(`Output:      ${outputHost}`);
console.log(`People:      ${people}`);
console.log(`Visible:     ${visible} / 17`);
console.log(`Status:      ${status}`);
if (mask.length === 17) {
  console.log('Keypoints:');
  for (let i = 0; i < 17; i++) {
    console.log(`  ${mask[i] ? '[x]' : '[ ]'} ${COCO_17[i]}`);
  }
}

process.exit(exit);
