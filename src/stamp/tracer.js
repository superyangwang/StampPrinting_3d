// Marching squares contour tracer for a binary mask.
//
// Output: closed loops in image (pixel) coordinates, with outer-vs-hole
// nesting classified so they can be turned into THREE.Shape + holes.
//
// Endpoint coordinates are stored as integers (doubled half-pixel coords)
// to make endpoint matching exact — no float compare. Each one names a grid
// edge; crossing() then finds where on that edge the outline really sits.

// Per-case segment list. Each segment is [startEdge, endEdge] where edges
// are 0=top, 1=right, 2=bottom, 3=left. Winding: traverse so the "inside"
// (mask == 1) is on the left of the direction of travel — this gives CCW
// outer loops and CW holes in image (y-down) coords, which we flip to
// CW outer / CCW holes when converting to world (y-up). THREE.Shape
// auto-detects holes via winding, so this just needs to be consistent.
const CASE_SEGMENTS = [
  [],                              // 0: 0000
  [[3, 0]],                        // 1: tl
  [[0, 1]],                        // 2: tr
  [[3, 1]],                        // 3: tl, tr
  [[1, 2]],                        // 4: br
  [[3, 0], [1, 2]],                // 5: tl, br        (saddle)
  [[0, 2]],                        // 6: tr, br
  [[3, 2]],                        // 7: tl, tr, br
  [[2, 3]],                        // 8: bl
  [[2, 0]],                        // 9: tl, bl
  [[0, 1], [2, 3]],                // 10: tr, bl       (saddle)
  [[2, 1]],                        // 11: tl, tr, bl
  [[1, 3]],                        // 12: bl, br
  [[1, 0]],                        // 13: tl, bl, br
  [[0, 3]],                        // 14: tr, bl, br
  [],                              // 15: 1111
];

// For cell at (i, j), encode the crossing on each edge using doubled coords.
// top:    (2i+1, 2j)
// right:  (2i+2, 2j+1)
// bottom: (2i+1, 2j+2)
// left:   (2i,   2j+1)
function edgePoint(i, j, edge) {
  switch (edge) {
    case 0: return [2 * i + 1, 2 * j];
    case 1: return [2 * i + 2, 2 * j + 1];
    case 2: return [2 * i + 1, 2 * j + 2];
    case 3: return [2 * i, 2 * j + 1];
  }
}

const keyOf = (p) => (p[0] * 100003 + p[1]) | 0; // good enough for image-sized grids
const sameKey = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Extract closed loops from a binary mask.
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @returns {Array<Array<[number, number]>>} loops in doubled pixel coords
 */
export function marchingSquares(mask, W, H) {
  // Collect oriented segments per cell.
  const segments = [];
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const tl = mask[j * W + i];
      const tr = mask[j * W + i + 1];
      const br = mask[(j + 1) * W + i + 1];
      const bl = mask[(j + 1) * W + i];
      const idx = tl | (tr << 1) | (br << 2) | (bl << 3);
      const segs = CASE_SEGMENTS[idx];
      for (const [eA, eB] of segs) {
        segments.push([edgePoint(i, j, eA), edgePoint(i, j, eB)]);
      }
    }
  }

  // Build start-key -> segment index map for linking.
  const startMap = new Map();
  for (let k = 0; k < segments.length; k++) {
    const key = keyOf(segments[k][0]);
    if (!startMap.has(key)) startMap.set(key, []);
    startMap.get(key).push(k);
  }

  const used = new Uint8Array(segments.length);
  const loops = [];
  for (let k = 0; k < segments.length; k++) {
    if (used[k]) continue;
    const startSeg = segments[k];
    const loop = [startSeg[0]];
    let current = startSeg;
    used[k] = 1;
    let safety = segments.length + 1;
    while (safety-- > 0) {
      const endKey = keyOf(current[1]);
      const cands = startMap.get(endKey);
      let next = -1;
      if (cands) {
        for (const ci of cands) {
          if (!used[ci]) { next = ci; break; }
        }
      }
      if (next < 0) {
        // Couldn't link further — push the open endpoint as the loop's last vertex
        // and stop. (Shouldn't happen if the mask has a clean outside border.)
        loop.push(current[1]);
        break;
      }
      const nextSeg = segments[next];
      used[next] = 1;
      loop.push(nextSeg[0]);
      if (sameKey(nextSeg[1], startSeg[0])) {
        // Closed loop: append the closing vertex so callers can detect
        // closure via sameKey(loop[0], loop[loop.length - 1]).
        loop.push(nextSeg[1]);
        break;
      }
      current = nextSeg;
    }
    loops.push(loop);
  }
  return loops;
}

// Where the outline really crosses a grid edge. marchingSquares reports the
// edge's midpoint (doubled coords); the field says how far along the edge the
// zero level actually sits, which is what removes the pixel staircase.
function crossing(p, field, W) {
  if (p[0] & 1) {
    // Horizontal edge between pixels (i, j) and (i + 1, j).
    const i = (p[0] - 1) / 2;
    const j = p[1] / 2;
    const a = field[j * W + i];
    const b = field[j * W + i + 1];
    return [i + a / (a - b), j];
  }
  // Vertical edge between pixels (i, j) and (i, j + 1).
  const i = p[0] / 2;
  const j = (p[1] - 1) / 2;
  const a = field[j * W + i];
  const b = field[(j + 1) * W + i];
  return [i, j + a / (a - b)];
}

// Signed area (image coords, y-down). Positive = CCW in y-down = CW in y-up.
function signedArea(loop) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += (b[0] - a[0]) * (b[1] + a[1]);
  }
  return s / 2;
}

// Point-in-polygon test (ray casting). Loop in doubled pixel coords.
function pointInLoop(p, loop) {
  let inside = false;
  const x = p[0], y = p[1];
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i][0], yi = loop[i][1];
    const xj = loop[j][0], yj = loop[j][1];
    const intersect =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Douglas-Peucker simplification. tol is in the loop's own units: a vertex is
 * dropped if it's within tol of the chord between its kept neighbors.
 */
function simplify(loop, tol) {
  if (loop.length < 4) return loop.slice();
  const t2 = tol * tol;
  const keep = new Uint8Array(loop.length);
  keep[0] = 1;
  keep[loop.length - 1] = 1;

  const stack = [[0, loop.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxD = -1, maxI = -1;
    const ax = loop[lo][0], ay = loop[lo][1];
    const bx = loop[hi][0], by = loop[hi][1];
    const dx = bx - ax, dy = by - ay;
    const denom = dx * dx + dy * dy || 1e-9;
    for (let i = lo + 1; i < hi; i++) {
      const px = loop[i][0], py = loop[i][1];
      const t = ((px - ax) * dx + (py - ay) * dy) / denom;
      const cx = ax + t * dx, cy = ay + t * dy;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > t2) {
      keep[maxI] = 1;
      stack.push([lo, maxI]);
      stack.push([maxI, hi]);
    }
  }
  const out = [];
  for (let i = 0; i < loop.length; i++) if (keep[i]) out.push(loop[i]);
  return out;
}

// Spacing, in pixels, of the evenly resampled outline used for smoothing.
const SMOOTH_STEP = 0.5;
// Loops smaller than this (px²) are specks of image noise, not pattern.
const MIN_LOOP_AREA = 1;

// Gaussian smoothing along a closed loop: resample it at even spacing, then
// replace each point by a weighted average of its neighbors within ~3 sigma.
// Unlike corner-cutting, the amount removed from a corner depends only on
// sigma (in pixels), never on how long the adjoining edges are — so straight
// strokes stay straight and letter corners stay crisp.
function smoothLoop(loop, sigma) {
  const n = loop.length;
  const seg = new Float64Array(n);
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    seg[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    perimeter += seg[i];
  }
  const m = Math.round(perimeter / SMOOTH_STEP);
  if (m < 8) return loop;
  const step = perimeter / m;
  // Cap sigma on small loops (dots, tiny counters) so they don't shrink away.
  const s = Math.min(sigma, perimeter / 20) / step;

  const rx = new Float64Array(m);
  const ry = new Float64Array(m);
  let k = 0;
  let walked = 0; // arc length at the start of segment k
  for (let j = 0; j < m; j++) {
    const target = j * step;
    while (k < n - 1 && walked + seg[k] < target) walked += seg[k++];
    const t = seg[k] > 0 ? (target - walked) / seg[k] : 0;
    const a = loop[k];
    const b = loop[(k + 1) % n];
    rx[j] = a[0] + t * (b[0] - a[0]);
    ry[j] = a[1] + t * (b[1] - a[1]);
  }

  const radius = Math.ceil(3 * s);
  const weights = new Float64Array(2 * radius + 1);
  let total = 0;
  for (let d = -radius; d <= radius; d++) {
    weights[d + radius] = Math.exp(-(d * d) / (2 * s * s));
    total += weights[d + radius];
  }
  const out = new Array(m);
  for (let j = 0; j < m; j++) {
    let x = 0;
    let y = 0;
    for (let d = -radius; d <= radius; d++) {
      const q = (j + d + m) % m;
      x += weights[d + radius] * rx[q];
      y += weights[d + radius] * ry[q];
    }
    out[j] = [x / total, y / total];
  }
  return out;
}

/**
 * Trace contours from a pattern mask and build a hierarchy of shapes with holes.
 *
 * @param {Uint8Array} mask
 * @param {number} W
 * @param {number} H
 * @param {object} [opts]
 * @param {Float32Array} [opts.field]      - signed field the mask came from
 *                                            (> 0 inside). Places the outline
 *                                            between pixels; without it edges
 *                                            fall on half-pixel steps.
 * @param {number} [opts.simplifyTol=0.05]  - tolerance in pixels for Douglas-Peucker
 * @param {number} [opts.smoothSigma=0]    - outline smoothing radius in pixels
 * @returns {Array<{ outer: Array<[number, number]>, holes: Array<Array<[number, number]>> }>}
 *          Loops are in PIXEL coords. Outer is CCW (y-down); holes are CW
 *          (y-down).
 */
export function traceShapes(mask, W, H, opts = {}) {
  const { field } = opts;
  const simplifyTol = opts.simplifyTol ?? 0.05;
  const smoothSigma = opts.smoothSigma ?? 0;
  const rawLoops = marchingSquares(mask, W, H);

  // Keep only closed loops with non-trivial area.
  const loops = [];
  for (const l of rawLoops) {
    if (l.length < 4) continue;
    if (!sameKey(l[0], l[l.length - 1])) {
      // Open loop (edge case) — drop it.
      continue;
    }
    // Strip the duplicate closing vertex and move to real pixel coords.
    let pts = l
      .slice(0, -1)
      .map((p) => (field ? crossing(p, field, W) : [p[0] / 2, p[1] / 2]));
    if (pts.length < 3) continue;
    if (smoothSigma > 0) pts = smoothLoop(pts, smoothSigma);
    const simp = simplify(pts, simplifyTol);
    if (simp.length < 3) continue;
    if (Math.abs(signedArea(simp)) < MIN_LOOP_AREA) continue;
    loops.push(simp);
  }

  // Classify: outer loops have signedArea > 0 (CCW in y-down), holes < 0.
  // But marching squares emits them with the "inside on left" rule, so
  // outer == positive area, holes == negative area. We verify via nesting too.
  const records = loops.map((loop) => ({
    loop,
    area: signedArea(loop),
    absArea: Math.abs(signedArea(loop)),
    depth: 0,
  }));
  records.sort((a, b) => b.absArea - a.absArea); // largest first

  // Compute nesting depth: for each loop, count how many other loops contain it.
  for (let i = 0; i < records.length; i++) {
    const inner = records[i];
    const sample = inner.loop[0];
    let depth = 0;
    for (let j = 0; j < i; j++) {
      if (pointInLoop(sample, records[j].loop)) depth++;
    }
    inner.depth = depth;
  }

  // Group: depth 0 = outer shape, depth 1 = hole, depth 2 = inner shape, etc.
  const shapes = [];
  for (const r of records) {
    if (r.depth % 2 === 0) {
      shapes.push({ outer: r.loop, holes: [] });
    } else {
      for (let s = shapes.length - 1; s >= 0; s--) {
        if (pointInLoop(r.loop[0], shapes[s].outer)) {
          shapes[s].holes.push(r.loop);
          break;
        }
      }
    }
  }
  return shapes;
}
