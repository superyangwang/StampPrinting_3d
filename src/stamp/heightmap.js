// Image -> pattern field. Black pixels become the raised pattern (toggle
// Invert to flip). The field is a signed distance to the pattern outline, so
// the contour tracer can place edges between pixels instead of on them.

// Pixel radii (line thickness) are expressed at this mask size, so the
// sliders keep their physical meaning whatever resolution we work at.
const REFERENCE_RESOLUTION = 384;
const FAR = 1e6;

// Blur radius (sigma, in pixels at 768 px) applied to the gray image before
// the outline is located. An antialiased edge is only ~1 pixel wide, too
// abrupt to interpolate reliably: the estimated edge would wander by a
// fraction of a pixel depending on where it falls on the grid, showing up as
// faint waves along straight strokes. Widening it slightly removes that.
const PREFILTER_PX = 0.8;

// Separable Gaussian blur, in place. Edges are clamped.
function gaussianBlur(src, W, H, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(2 * radius + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
    total += kernel[k + radius];
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= total;

  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= W ? W - 1 : x + k;
        v += kernel[k + radius] * src[y * W + xx];
      }
      tmp[y * W + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= H ? H - 1 : y + k;
        v += kernel[k + radius] * tmp[yy * W + x];
      }
      src[y * W + x] = v;
    }
  }
}

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

// Signed distance, in pixels, from every pixel center to the
// gray == threshold contour: negative inside the ink, positive outside.
//
// Antialiased edges carry sub-pixel information — a pixel that is 30% gray
// sits a known fraction of a pixel from the edge. Each pixel next to the
// contour is seeded with its nearest contour point (found from the local
// slope), then those points are swept across the grid (8SSEDT) so every
// pixel knows its true Euclidean distance to the outline.
function signedDistanceField(gray, W, H, threshold) {
  const n = W * H;
  const sx = new Float32Array(n); // nearest contour point per pixel
  const sy = new Float32Array(n);
  const d2 = new Float32Array(n).fill(Infinity);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const g = gray[i];
      const inside = g > threshold;
      const l = x > 0 ? gray[i - 1] : g;
      const r = x < W - 1 ? gray[i + 1] : g;
      const u = y > 0 ? gray[i - W] : g;
      const d = y < H - 1 ? gray[i + W] : g;
      const cl = l > threshold !== inside;
      const cr = r > threshold !== inside;
      const cu = u > threshold !== inside;
      const cd = d > threshold !== inside;
      if (!(cl || cr || cu || cd)) continue;
      // Slope toward the neighbor on the far side of the contour (the
      // steeper one if both are); plain central difference otherwise.
      const gx =
        cr && (!cl || Math.abs(r - g) >= Math.abs(g - l)) ? r - g
        : cl ? g - l
        : (r - l) / 2;
      const gy =
        cd && (!cu || Math.abs(d - g) >= Math.abs(g - u)) ? d - g
        : cu ? g - u
        : (d - u) / 2;
      const k = (threshold - g) / (gx * gx + gy * gy);
      sx[i] = x + gx * k;
      sy[i] = y + gy * k;
      d2[i] = (gx * k) * (gx * k) + (gy * k) * (gy * k);
    }
  }

  // Adopt neighbor j's contour point for pixel i if it is closer.
  const relax = (i, x, y, j) => {
    if (d2[j] === Infinity) return;
    const dx = sx[j] - x;
    const dy = sy[j] - y;
    const dist = dx * dx + dy * dy;
    if (dist < d2[i]) {
      d2[i] = dist;
      sx[i] = sx[j];
      sy[i] = sy[j];
    }
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x > 0) relax(i, x, y, i - 1);
      if (y > 0) {
        relax(i, x, y, i - W);
        if (x > 0) relax(i, x, y, i - W - 1);
        if (x < W - 1) relax(i, x, y, i - W + 1);
      }
    }
    for (let x = W - 2; x >= 0; x--) relax(y * W + x, x, y, y * W + x + 1);
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (x < W - 1) relax(i, x, y, i + 1);
      if (y < H - 1) {
        relax(i, x, y, i + W);
        if (x < W - 1) relax(i, x, y, i + W + 1);
        if (x > 0) relax(i, x, y, i + W - 1);
      }
    }
    for (let x = 1; x < W; x++) relax(y * W + x, x, y, y * W + x - 1);
  }

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dist = d2[i] === Infinity ? FAR : Math.sqrt(d2[i]);
    out[i] = gray[i] > threshold ? -dist : dist;
  }
  return out;
}

/**
 * Build the pattern field (and its binary mask) for the stamp.
 *
 * @param {ImageData} imageData
 * @param {object} opts
 * @param {'rect'|'round'} opts.shape
 * @param {number} opts.widthMm
 * @param {number} opts.depthMm
 * @param {boolean} opts.invert
 * @param {boolean} [opts.mirror=false]    - flip the mask left-right (so the
 *                                            imprint reads the same as the source)
 * @param {number} [opts.threshold=0.2]    - 0..1; lower = more pixels qualify as "black"
 * @param {number} [opts.contrast=1.8]     - 1 = no change; >1 = push grays toward 0/1
 * @param {number} [opts.lineThickenPx=0]  - fattens every raised line by this many
 *                                            pixels in all directions, measured at
 *                                            REFERENCE_RESOLUTION. Fractions are fine.
 * @param {number} [opts.imageScalePct=100] - shrinks the design inside the stamp;
 *                                            relaxes the round clip ellipse to match.
 * @param {number} [opts.maxResolution=768]
 * @returns {{ W: number, H: number, mask: Uint8Array, field: Float32Array }}
 *          field > 0 inside the pattern, in pixels from its outline; mask is
 *          the same thing as on/off pixels.
 */
export function buildMasks(imageData, opts) {
  const {
    shape,
    invert,
    mirror = false,
    threshold = 0.3,
    contrast = 1.8,
    lineThickenPx = 0,
    imageScalePct = 100,
    maxResolution = 768,
  } = opts;

  const scaled = downscale(imageData, maxResolution);
  const W = scaled.width;
  const H = scaled.height;
  const gray = imageDataToGrayscale(scaled);
  if (invert) {
    for (let i = 0; i < gray.length; i++) gray[i] = 1 - gray[i];
  }

  const pxScale = Math.max(W, H) / REFERENCE_RESOLUTION;
  gaussianBlur(gray, W, H, PREFILTER_PX * (pxScale / 2));

  // Contrast stretches gray around the midpoint before thresholding, which
  // picks out exactly the same pixels as thresholding the unstretched image
  // at a level pulled toward 0.5. Doing it that way keeps the edge ramp
  // intact (a stretch clips it), so the outline can be placed within it.
  const level = 0.5 + (threshold - 0.5) / Math.max(contrast, 1e-3);

  // Thickening is just a shifted contour level: the pattern is everything
  // within `radius` of the original ink. Because the distances are true
  // Euclidean ones, thickened lines keep smooth sides and round ends.
  const radius = lineThickenPx * pxScale;
  const field = signedDistanceField(gray, W, H, level);
  for (let i = 0; i < field.length; i++) field[i] = radius - field[i];

  // Two limits on where the pattern may be, both applied as a smooth cap on
  // the field so the cut edge is as clean as the rest of the outline:
  //  - a 1-pixel empty border so every contour closes;
  //  - round shape only: the inscribed ellipse, so the pattern can't extend
  //    past the disk wall. The mesh stage scales pixel coords to mm by
  //    (widthMm * imageScalePct/100), so the cylinder wall in normalized
  //    pixel coords sits at radius 1 / (imageScalePct/100).
  const clipR = 100 / imageScalePct;
  const pxPerUnit = (Math.min(W, H) - 1) / 2;
  for (let j = 0; j < H; j++) {
    const ny = (j / (H - 1)) * 2 - 1;
    for (let i = 0; i < W; i++) {
      let limit = Math.min(i, j, W - 1 - i, H - 1 - j) - 0.5;
      if (shape === 'round') {
        const nx = (i / (W - 1)) * 2 - 1;
        limit = Math.min(limit, (clipR - Math.hypot(nx, ny)) * pxPerUnit);
      }
      if (limit < field[j * W + i]) field[j * W + i] = limit;
    }
  }

  if (mirror) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0, end = W >> 1; x < end; x++) {
        const a = row + x;
        const b = row + (W - 1 - x);
        const tmp = field[a];
        field[a] = field[b];
        field[b] = tmp;
      }
    }
  }

  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = field[i] > 0 ? 1 : 0;

  return { W, H, mask, field };
}
