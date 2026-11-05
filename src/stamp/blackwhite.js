// Upload-time cleanup. The mask pipeline in heightmap.js expects dark ink on
// a light background; color images and shaded grayscale ones threshold badly
// there, so they are reduced to pure black/white first. Images that are
// already black and white pass through untouched, keeping their antialiased
// edges for the Line sensitivity / Contrast sliders.

const CHROMA_LIMIT = 0.12;   // channel spread above this reads as "colored"
const COLORED_SHARE = 0.005; // more colored pixels than this = color image
const MIDTONE_SHARE = 0.15;  // more mid-gray pixels than this = shaded image

// Otsu's method: the cut that best separates the histogram into two groups.
function otsuThreshold(hist, total) {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    sumB += t * hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    const diff = sumB / wB - (sumAll - sumB) / wF;
    const v = wB * wF * diff * diff;
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

/**
 * Convert the image to pure black/white in place unless it already is.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData
 * @returns {boolean} true if the pixels were converted
 */
export function ensureBlackAndWhite(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const dark = new Uint8Array(n); // 0 = white or transparent, 255 = opaque black
  const hist = new Uint32Array(256);
  let colored = 0;
  let midtone = 0;
  for (let i = 0; i < n; i++) {
    // Composite onto white so transparent pixels count as background, same
    // as imageDataToGrayscale in heightmap.js.
    const a = data[i * 4 + 3] / 255;
    const r = 255 - (255 - data[i * 4]) * a;
    const g = 255 - (255 - data[i * 4 + 1]) * a;
    const b = 255 - (255 - data[i * 4 + 2]) * a;
    const d = Math.round(255 - (0.2126 * r + 0.7152 * g + 0.0722 * b));
    dark[i] = d;
    hist[d]++;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (chroma > CHROMA_LIMIT) colored++;
    else if (d > 64 && d < 191) midtone++;
  }

  // A few gray pixels are just antialiased edges of a black/white drawing.
  if (colored <= n * COLORED_SHARE && midtone <= n * MIDTONE_SHARE) return false;

  const t = otsuThreshold(hist, n);
  for (let i = 0; i < n; i++) {
    const v = dark[i] > t ? 0 : 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return true;
}
