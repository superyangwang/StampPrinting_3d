// Node CLI: PNG -> STL using the same pipeline as the browser app.
//
// Usage:
//   node scripts/png-to-stl.mjs <input.png> [output.stl] [--key=value ...]
//
// Keys mirror DEFAULTS in src/App.jsx:
//   shape=round|rect
//   widthMm  depthMm
//   reliefDepthMm  baseThicknessMm
//   invert=true|false
//   handleEnabled=true|false  handleRadiusMm  handleHeightMm  handleTransitionAngleDeg

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { PNG } from 'pngjs';
import { buildMasks } from '../src/stamp/heightmap.js';
import { buildStampGeometry } from '../src/stamp/mesh.js';
import { geometryToBinarySTL } from '../src/stamp/stl.js';

const DEFAULTS = {
  shape: 'round',
  widthMm: 40,
  depthMm: 40,
  reliefDepthMm: 2,
  baseThicknessMm: 3,
  rollingEnabled: false,
  rollingRadiusMm: 50,
  invert: false,
  threshold: 0.25,
  contrast: 1.8,
  smoothIterations: 1,
  imageScalePct: 90,
  handleEnabled: true,
  handleRadiusMm: 10,            // 25% of default 40 mm stamp diameter
  handleHeightMm: 10,            // same as radius
  handleTransitionAngleDeg: 45,
  handleGripHeightMm: 10,
};

function parseArgs(argv) {
  const positional = [];
  const opts = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      if (!(k in opts)) throw new Error(`Unknown option: ${k}`);
      opts[k] = coerce(opts[k], v);
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

function coerce(prev, value) {
  if (typeof prev === 'boolean') return value === 'true' || value === '1';
  if (typeof prev === 'number') {
    const n = Number(value);
    if (Number.isNaN(n)) throw new Error(`Expected number, got: ${value}`);
    return n;
  }
  return value;
}

// Pre-downscale to fit maxSide so src/stamp/heightmap.js's canvas-based
// downscale() short-circuits (no DOM in Node).
function decodePngDownscaled(buf, maxSide = 384) {
  const png = PNG.sync.read(buf);
  const { width: w0, height: h0, data: src } = png;
  const longest = Math.max(w0, h0);
  if (longest <= maxSide) {
    return { width: w0, height: h0, data: new Uint8ClampedArray(src) };
  }
  const scale = maxSide / longest;
  const w = Math.max(2, Math.round(w0 * scale));
  const h = Math.max(2, Math.round(h0 * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * h0) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * h0) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * w0) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * w0) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * w0 + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
          n++;
        }
      }
      const di = (y * w + x) * 4;
      out[di] = r / n;
      out[di + 1] = g / n;
      out[di + 2] = b / n;
      out[di + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  if (positional.length === 0) {
    console.error('Usage: node scripts/png-to-stl.mjs <input.png> [output.stl] [--key=value ...]');
    process.exit(1);
  }
  const inputPath = resolve(positional[0]);
  const outputPath = resolve(
    positional[1] || basename(inputPath, extname(inputPath)) + '.stl',
  );

  console.log(`Loading ${inputPath}`);
  const png = decodePngDownscaled(readFileSync(inputPath), 384);
  console.log(`  decoded ${png.width}x${png.height}`);

  console.log('Building mask...');
  const masks = buildMasks(png, { ...opts, maxResolution: Math.max(png.width, png.height) });

  console.log('Building geometry...');
  const geom = buildStampGeometry(masks, opts);
  if (!geom) {
    console.error('No geometry was produced — the mask is empty. Try toggling --invert=true.');
    process.exit(2);
  }
  const triCount = geom.getAttribute('position').count / 3;

  console.log('Writing STL...');
  const buffer = geometryToBinarySTL(geom);
  writeFileSync(outputPath, Buffer.from(buffer));
  const sizeMb = (buffer.byteLength / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${outputPath} (${triCount} triangles, ${sizeMb} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
