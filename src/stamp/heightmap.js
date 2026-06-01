// Image -> binary mask. Black pixels become the raised pattern (toggle Invert
// to flip). The mask is the input to the contour tracer.

function imageDataToGrayscale(imageData) {
  const { data, width, height } = imageData;
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    // "Darkness" weighted by alpha. 1 = opaque black, 0 = white or transparent.
    out[i] = (1 - luma) * a;
  }
  return out;
}

function downscale(imageData, maxSide) {
  const { width, height } = imageData;
  const longest = Math.max(width, height);
  if (longest <= maxSide) return imageData;
  const scale = maxSide / longest;
  const w = Math.max(2, Math.round(width * scale));
  const h = Math.max(2, Math.round(height * scale));
  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Build the binary mask for the stamp pattern.
 *
 * @param {ImageData} imageData
 * @param {object} opts
 * @param {'rect'|'round'} opts.shape
 * @param {number} opts.widthMm
 * @param {number} opts.depthMm
 * @param {boolean} opts.invert
 * @param {number} [opts.threshold=0.2]    - 0..1; lower = more pixels qualify as "black"
 * @param {number} [opts.contrast=1.8]     - 1 = no change; >1 = push grays toward 0/1
 * @param {number} [opts.lineThickenPx=0]  - morphological dilation passes on the binary
 *                                            mask. Each pass fattens every raised line by
 *                                            one mask-pixel in all directions.
 * @param {number} [opts.imageScalePct=100] - shrinks the design inside the stamp;
 *                                            relaxes the round clip ellipse to match.
 * @param {number} [opts.maxResolution=384]
 * @returns {{ W: number, H: number, mask: Uint8Array }}
 */
export function buildMasks(imageData, opts) {
  const {
    shape,
    invert,
    threshold = 0.3,
    contrast = 1.8,
    lineThickenPx = 0,
    imageScalePct = 100,
    maxResolution = 384,
  } = opts;

  const scaled = downscale(imageData, maxResolution);
  const W = scaled.width;
  const H = scaled.height;
  const gray = imageDataToGrayscale(scaled);
  if (invert) {
    for (let i = 0; i < gray.length; i++) gray[i] = 1 - gray[i];
  }

  // Contrast stretch around the midpoint to push antialiased gray edges
  // toward solid black/white before we threshold.
  if (contrast !== 1) {
    for (let i = 0; i < gray.length; i++) {
      const v = (gray[i] - 0.5) * contrast + 0.5;
      gray[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  // 1-pixel transparent border so all contours close cleanly.
  for (let x = 0; x < W; x++) {
    gray[x] = 0;
    gray[(H - 1) * W + x] = 0;
  }
  for (let y = 0; y < H; y++) {
    gray[y * W] = 0;
    gray[y * W + W - 1] = 0;
  }

  // Round shape: clip outside the inscribed ellipse so the pattern can't
  // extend past the disk wall. The mesh stage scales pixel coords to mm by
  // (widthMm * imageScalePct/100), so the cylinder wall in normalized pixel
  // coords sits at radius 1 / (imageScalePct/100). Anything inside that gets
  // through, anything past it would poke through the side of the disk.
  if (shape === 'round') {
    const s = imageScalePct / 100;
    const clipR2 = 1 / (s * s);
    for (let j = 0; j < H; j++) {
      const ny = (j / (H - 1)) * 2 - 1;
      for (let i = 0; i < W; i++) {
        const nx = (i / (W - 1)) * 2 - 1;
        if (nx * nx + ny * ny > clipR2) gray[j * W + i] = 0;
      }
    }
  }

  let mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = gray[i] > threshold ? 1 : 0;

  if (lineThickenPx > 0) {
    mask = dilateMask(mask, W, H, lineThickenPx);
    // Dilation can push pixels into the clip-ellipse / border zone we cleared
    // earlier. Re-enforce both constraints so lines still can't punch through
    // the disk wall or break contour closure.
    if (shape === 'round') {
      const s = imageScalePct / 100;
      const clipR2 = 1 / (s * s);
      for (let j = 0; j < H; j++) {
        const ny = (j / (H - 1)) * 2 - 1;
        for (let i = 0; i < W; i++) {
          const nx = (i / (W - 1)) * 2 - 1;
          if (nx * nx + ny * ny > clipR2) mask[j * W + i] = 0;
        }
      }
    }
    for (let x = 0; x < W; x++) {
      mask[x] = 0;
      mask[(H - 1) * W + x] = 0;
    }
    for (let y = 0; y < H; y++) {
      mask[y * W] = 0;
      mask[y * W + W - 1] = 0;
    }
  }

  return { W, H, mask };
}

// Fractional dilation via Chamfer 3-4 distance transform. Computes the
// distance from every off-pixel to the nearest on-pixel, then re-thresholds
// at `radius` pixels — so a radius of 1.5 fattens lines by ~1.5 mask-pixels,
// not just integer steps. Chamfer 3-4 is ~96% accurate Euclidean and runs
// in two raster passes.
function dilateMask(mask, W, H, radius) {
  const INF = 1e9;
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = mask[i] ? 0 : INF;

  // Forward pass: top-left to bottom-right. Cardinal=3, diagonal=4.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      let d = dist[idx];
      if (x > 0)                d = Math.min(d, dist[idx - 1] + 3);
      if (y > 0)                d = Math.min(d, dist[idx - W] + 3);
      if (x > 0 && y > 0)       d = Math.min(d, dist[idx - W - 1] + 4);
      if (x < W - 1 && y > 0)   d = Math.min(d, dist[idx - W + 1] + 4);
      dist[idx] = d;
    }
  }
  // Backward pass: bottom-right to top-left.
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const idx = y * W + x;
      let d = dist[idx];
      if (x < W - 1)              d = Math.min(d, dist[idx + 1] + 3);
      if (y < H - 1)              d = Math.min(d, dist[idx + W] + 3);
      if (x < W - 1 && y < H - 1) d = Math.min(d, dist[idx + W + 1] + 4);
      if (x > 0 && y < H - 1)     d = Math.min(d, dist[idx + W - 1] + 4);
      dist[idx] = d;
    }
  }

  const threshold = radius * 3; // convert pixel radius to chamfer units
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = dist[i] <= threshold ? 1 : 0;
  return out;
}
