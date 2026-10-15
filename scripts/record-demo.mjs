// Drives the live stamp generator with sample.png and records a ~50s demo.
// Captions are injected into the page so they're baked into the video.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLE = path.join(ROOT, 'sample.png');
const OUT_DIR = path.join(ROOT, 'demo-recording');
const URL_ = process.env.DEMO_URL || 'http://localhost:5173/';

const WIDTH = 1280;
const HEIGHT = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function caption(page, text, ms = 2500) {
  await page.evaluate((t) => {
    let el = document.getElementById('__demo_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__demo_caption';
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: '6%',
        transform: 'translateX(-50%)',
        background: 'rgba(15, 18, 24, 0.92)',
        color: '#fff',
        padding: '14px 28px',
        borderRadius: '12px',
        font: '600 26px/1.2 system-ui, -apple-system, Segoe UI, sans-serif',
        letterSpacing: '0.3px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
        zIndex: '999999',
        pointerEvents: 'none',
        textAlign: 'center',
        maxWidth: '80vw',
        transition: 'opacity 200ms ease',
        opacity: '0',
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  }, text);
  await sleep(ms);
}

async function hideCaption(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__demo_caption');
    if (el) el.style.opacity = '0';
  });
  await sleep(200);
}

async function showImageOverlay(page, dataUrl, ms = 3000) {
  await page.evaluate((src) => {
    let wrap = document.getElementById('__demo_imgwrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = '__demo_imgwrap';
      Object.assign(wrap.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(15, 18, 24, 0.96)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '999998',
        opacity: '0',
        transition: 'opacity 250ms ease',
      });
      const img = document.createElement('img');
      img.id = '__demo_img';
      Object.assign(img.style, {
        maxWidth: '60vw',
        maxHeight: '75vh',
        background: '#fff',
        padding: '18px',
        borderRadius: '14px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      });
      wrap.appendChild(img);
      document.body.appendChild(wrap);
    }
    document.getElementById('__demo_img').src = src;
    requestAnimationFrame(() => { wrap.style.opacity = '1'; });
  }, dataUrl);
  await sleep(ms);
}

async function hideImageOverlay(page) {
  await page.evaluate(() => {
    const wrap = document.getElementById('__demo_imgwrap');
    if (wrap) wrap.style.opacity = '0';
  });
  await sleep(300);
  await page.evaluate(() => {
    const wrap = document.getElementById('__demo_imgwrap');
    if (wrap) wrap.style.display = 'none';
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: OUT_DIR, size: { width: WIDTH, height: HEIGHT } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('[demo] navigating', URL_);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await sleep(600);

  await caption(page, 'Make a custom 3D-printable stamp in your browser', 3000);
  await hideCaption(page);

  // Intro: show the source image so the viewer knows what we're about to upload
  const sampleDataUrl =
    'data:image/png;base64,' + fs.readFileSync(SAMPLE).toString('base64');
  await showImageOverlay(page, sampleDataUrl, 100);
  await caption(page, 'Start with any line drawing — here’s sample.png', 3200);
  await hideCaption(page);
  await hideImageOverlay(page);

  // Step 1: upload sample.png
  await caption(page, '1. Upload your image (sample.png)', 2200);
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(SAMPLE);
  // Give the geometry pipeline time to build
  await sleep(2200);
  await hideCaption(page);
  await caption(page, 'Preview renders in 3D as you adjust settings', 3200);
  await hideCaption(page);

  // Step 2: size
  await caption(page, '2. Set the stamp size', 1800);
  const diameter = page.locator('section').filter({ hasText: 'Stamp size' }).locator('input[type="number"]').first();
  await diameter.click({ clickCount: 3 });
  await diameter.fill('50');
  await diameter.press('Tab');
  await sleep(1800);
  await hideCaption(page);

  // Step 3: relief / draft
  await caption(page, '3. Tune relief depth and draft angle', 2000);
  const draft = page.locator('input[type="range"]').nth(0); // first range is draft angle
  await draft.focus();
  for (let i = 0; i < 4; i++) {
    await draft.press('ArrowRight');
    await sleep(120);
  }
  await sleep(1200);
  await hideCaption(page);

  // Step 4: line settings
  await caption(page, '4. Refine line sensitivity & thickness', 2200);
  // ranges in order: draft(0), imageScale(1), threshold(2), contrast(3), lineThicken(4), smooth(5)
  const threshold = page.locator('input[type="range"]').nth(2);
  await threshold.focus();
  for (let i = 0; i < 5; i++) {
    await threshold.press('ArrowLeft');
    await sleep(100);
  }
  const lineThicken = page.locator('input[type="range"]').nth(4);
  await lineThicken.focus();
  for (let i = 0; i < 3; i++) {
    await lineThicken.press('ArrowRight');
    await sleep(120);
  }
  await sleep(1400);
  await hideCaption(page);

  // Step 5: rotate the 3D preview a bit by dragging the canvas
  await caption(page, 'Drag the preview to rotate', 1800);
  const canvas = page.locator('canvas').last();
  const box = await canvas.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(cx + i * 8, cy - i * 2, { steps: 2 });
      await sleep(40);
    }
    await page.mouse.up();
  }
  await sleep(900);
  await hideCaption(page);

  // Step 6: Generate STL
  await caption(page, '5. Click Generate STL', 2000);
  await page.getByRole('button', { name: /generate stl/i }).click();
  await sleep(1500);
  await hideCaption(page);

  // Step 7: Download
  await caption(page, '6. Download the .stl and print it!', 2600);
  // We won't actually trigger the file save dialog — just highlight the button.
  const dlBtn = page.getByRole('button', { name: /download stl/i });
  await dlBtn.hover();
  await sleep(800);
  await hideCaption(page);

  await caption(page, 'That’s it — your stamp is ready to 3D-print.', 3000);
  await hideCaption(page);

  await context.close();
  await browser.close();
  console.log('[demo] saved video to', OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
