#!/usr/bin/env node
/**
 * Luna UI verification via Chrome CDP.
 *
 * Usage: node scripts/screenshot.mjs [scenario]
 * Scenarios: basic, img2img, foundation, all (default)
 *
 * Differences vs. lumi/scripts/screenshot.mjs:
 *   - COMFY_URL  → http://localhost:18190  (Luna port; Lumi = 18188)
 *   - SCREENSHOTS_DIR → luna/screenshots/  (NOT lumi/screenshots/)
 *   - APP_URL stays http://localhost:4200 (Angular dev server, same port).
 *
 * Requires Chrome/Chromium with remote debugging enabled (auto-launched).
 * Start Angular dev server first: `ng serve` in apps/web/ (when it exists).
 * Start ComfyUI: `Luna.bat` (docker compose up).
 *
 * Inherited deps: `ws` (WebSocket client) — not in node stdlib. See package.json.
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');
const APP_URL = 'http://localhost:4200';
const COMFY_URL = 'http://localhost:18190';
const CDP_PORT = 9222;

let chromeProcess = null;

// ── helpers ────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = new URL(url);
    const req = http.request({
      hostname: opts.hostname, port: opts.port, path: opts.pathname + opts.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Chrome CDP ─────────────────────────────────────────────────────────────

async function startChrome() {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    'chromium',
  ];

  let chromePath = process.env.CHROME_PATH;
  if (!chromePath) {
    for (const p of chromePaths) {
      try { fs.accessSync(p); chromePath = p; break; } catch {}
    }
  }

  if (!chromePath) {
    console.error('Chrome not found. Set CHROME_PATH env var.');
    process.exit(1);
  }

  chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1440,900',
    APP_URL,
  ], { stdio: 'ignore' });

  await sleep(2000);
}

async function getCdpTarget() {
  const targets = await get(`http://localhost:${CDP_PORT}/json`);
  return targets.find(t => t.type === 'page' && t.url.includes('localhost:4200'));
}

async function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + Math.random();
    const msg = JSON.stringify({ id, method, params });

    ws.once('message', data => {
      const res = JSON.parse(data);
      if (res.error) reject(new Error(res.error.message));
      else resolve(res.result);
    });
    ws.send(msg);
  });
}

async function connectCdp() {
  const target = await getCdpTarget();
  if (!target) throw new Error('No CDP target found — is Chrome running?');

  const { WebSocket } = await import('ws').catch(() => {
    console.error('ws package not found. Run: npm install ws --save-dev at repo root.');
    process.exit(1);
  });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function screenshot(ws, name) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const { data } = await cdpSend(ws, 'Page.captureScreenshot', { format: 'png', quality: 90 });
  const outPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(`  📸 ${outPath}`);
  return outPath;
}

async function navigate(ws, url) {
  await cdpSend(ws, 'Page.navigate', { url });
  await sleep(1500);
}

async function evaluate(ws, expression) {
  const result = await cdpSend(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  return result?.result?.value;
}

async function click(ws, selector) {
  const rect = await evaluate(ws, `
    (() => {
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    })()
  `);
  if (!rect) throw new Error(`Element not found: ${selector}`);
  await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await cdpSend(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(300);
}

async function typeText(ws, selector, text) {
  await click(ws, selector);
  await evaluate(ws, `
    (() => {
      const el = document.querySelector('${selector}');
      if (!el) return;
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  for (const char of text) {
    await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char });
    await cdpSend(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', text: char });
  }
  await sleep(200);
}

// ── Scenario checks ────────────────────────────────────────────────────────

async function checkComfyConnection() {
  try {
    await get(`${COMFY_URL}/system_stats`);
    console.log('  ✅ ComfyUI reachable on 18190');
    return true;
  } catch {
    console.log('  ⚠️  ComfyUI not running on 18190 — UI tests will run in offline mode');
    return false;
  }
}

async function checkAppLoads(ws) {
  console.log('\n[1] App load check');
  await navigate(ws, APP_URL);
  await screenshot(ws, '01_app_load');

  const toolbar = await evaluate(ws, `!!document.querySelector('mat-toolbar')`);
  const logo = await evaluate(ws, `document.querySelector('.logo')?.textContent?.trim()`);

  console.log(`  toolbar: ${toolbar ? '✅' : '❌'}`);
  console.log(`  logo text: ${logo === 'Luna' ? '✅ "Luna"' : `❌ got "${logo}"`}`);
  return toolbar && logo === 'Luna';
}

async function checkGeneratorUI(ws) {
  console.log('\n[2] Generator UI check');
  await navigate(ws, `${APP_URL}/`);
  await sleep(500);
  await screenshot(ws, '02_generator_empty');

  const promptField = await evaluate(ws, `!!document.querySelector('textarea')`);
  const generateBtn = await evaluate(ws, `!!document.querySelector('button.generate-btn')`);
  const modeToggle = await evaluate(ws, `!!document.querySelector('.mode-toggle')`);

  console.log(`  prompt textarea: ${promptField ? '✅' : '❌'}`);
  console.log(`  generate button: ${generateBtn ? '✅' : '❌'}`);
  console.log(`  mode toggle: ${modeToggle ? '✅' : '❌'}`);
  return promptField && generateBtn && modeToggle;
}

async function checkImg2ImgMode(ws) {
  console.log('\n[3] img2img mode switch');
  const btns = await evaluate(ws, `
    (() => {
      const btns = [...document.querySelectorAll('.mode-toggle button')];
      return btns.map(b => b.textContent?.trim());
    })()
  `);
  console.log(`  mode buttons: ${JSON.stringify(btns)}`);

  await evaluate(ws, `
    (() => {
      const btns = [...document.querySelectorAll('.mode-toggle button')];
      const img2img = btns.find(b => b.textContent?.includes('Image to image'));
      img2img?.click();
    })()
  `);
  await sleep(400);
  await screenshot(ws, '03_img2img_mode');

  const uploadZone = await evaluate(ws, `!!document.querySelector('.upload-zone')`);
  const denoiseSlider = await evaluate(ws, `!!document.querySelector('.slider-row mat-slider')`);

  console.log(`  upload zone: ${uploadZone ? '✅' : '❌'}`);
  console.log(`  denoise slider: ${denoiseSlider ? '✅' : '❌'}`);
  return uploadZone;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const scenario = process.argv[2] ?? 'all';
  console.log(`\n🔍 Luna UI verification — scenario: ${scenario}\n`);

  await checkComfyConnection();

  console.log('Starting Chrome…');
  await startChrome();

  let ws;
  try {
    ws = await connectCdp();
    await cdpSend(ws, 'Page.enable');

    const results = [];

    if (scenario === 'all' || scenario === 'basic') {
      results.push(['App loads', await checkAppLoads(ws)]);
      results.push(['Generator UI', await checkGeneratorUI(ws)]);
    }
    if (scenario === 'all' || scenario === 'img2img') {
      await navigate(ws, APP_URL);
      results.push(['img2img mode', await checkImg2ImgMode(ws)]);
    }

    console.log('\n── Results ──────────────────────────────');
    let allPassed = true;
    for (const [name, passed] of results) {
      console.log(`  ${passed ? '✅' : '❌'} ${name}`);
      if (!passed) allPassed = false;
    }
    console.log('─────────────────────────────────────────');
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}\n`);

    process.exit(allPassed ? 0 : 1);
  } finally {
    ws?.close();
    chromeProcess?.kill();
  }
}

main().catch(err => {
  console.error(err);
  chromeProcess?.kill();
  process.exit(1);
});
