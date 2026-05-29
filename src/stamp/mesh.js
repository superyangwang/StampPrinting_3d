// Build the stamp geometry by extruding the traced mask, plus a base and
// (optionally) a conical handle on the back.
//
//                  ┌── pattern (relief) ── extruded mask, height = reliefMm
//   z+  ▲   ┌──────┴───────┐
//       │   │    base      │ ── disk (round) or slab (square), height = baseMm
//   0 ──┼───┴──┐       ┌───┴──
//       │      │  cone │            handle: cone, flared from base, tapering
//       │      │       │            to top radius over handleHeight
//   z-  ▼      └───────┘
//
// Handle transition angle = angle from vertical. 0° = straight cylinder;
// larger angles = wider base, narrower top.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { traceShapes } from './tracer.js';

export function buildStampGeometry(masks, opts) {
  const geoms = [];

  const pattern = buildPatternGeometry(masks, opts);
  if (pattern) {
    applyRollingCurveToPattern(pattern, opts);
    geoms.push(pattern);
  }

  geoms.push(buildBaseGeometry(opts));

  if (opts.handleEnabled && opts.handleRadiusMm > 0 && opts.handleHeightMm > 0) {
    geoms.push(...buildHandleGeometry(opts));
  }

  // Normalize to position-only, non-indexed so mergeGeometries accepts them.
  const normalized = geoms.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(ng.attributes)) {
      if (name !== 'position') ng.deleteAttribute(name);
    }
    return ng;
  });
  const merged = mergeGeometries(normalized, false);
  merged.computeVertexNormals();
  return merged;
}

function buildPatternGeometry(masks, opts) {
  const { mask, W, H } = masks;
  const {
    widthMm,
    depthMm,
    baseThicknessMm,
    reliefDepthMm,
    smoothIterations,
    imageScalePct = 100,
  } = opts;

  const scale = imageScalePct / 100;
  const shapes = maskToShapes(mask, W, H, widthMm * scale, depthMm * scale, smoothIterations);
  if (shapes.length === 0) return null;

  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: reliefDepthMm,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 4,
  });
  geo.translate(0, 0, baseThicknessMm);
  return geo;
}

function maskToShapes(mask, W, H, widthMm, depthMm, smoothIterations = 0) {
  const traced = traceShapes(mask, W, H, { simplifyTol: 1, smoothIterations });
  const shapes = [];
  for (const { outer, holes } of traced) {
    const shape = new THREE.Shape();
    loopToPath(outer, W, H, widthMm, depthMm, shape);
    for (const hole of holes) {
      const path = new THREE.Path();
      loopToPath(hole, W, H, widthMm, depthMm, path);
      shape.holes.push(path);
    }
    shapes.push(shape);
  }
  return shapes;
}

// Pixel coords (y-down, origin top-left) -> mm centered on origin (y-up).
// Reversing restores CCW outer / CW hole winding after the Y flip.
function loopToPath(loop, W, H, widthMm, depthMm, path) {
  const reversed = loop.slice().reverse();
  for (let i = 0; i < reversed.length; i++) {
    const [px, py] = reversed[i];
    const x = (px / (W - 1) - 0.5) * widthMm;
    const y = (0.5 - py / (H - 1)) * depthMm;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
}

function buildBaseGeometry(opts) {
  const { shape, widthMm, depthMm, baseThicknessMm, rollingRadiusMm = 0 } = opts;

  // Rolling mode overrides the shape: a rocker (flat bottom, cylindrically
  // curved top) is the only shape that rolls coherently.
  if (opts.rollingEnabled && rollingRadiusMm >= widthMm / 2) {
    return buildRockerBaseGeometry(opts);
  }
  if (shape === 'round') {
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, baseThicknessMm, 96, 1);
    cyl.rotateX(Math.PI / 2);
    cyl.scale(widthMm, depthMm, 1);
    cyl.translate(0, 0, baseThicknessMm / 2);
    return cyl;
  }
  const box = new THREE.BoxGeometry(widthMm, depthMm, baseThicknessMm);
  box.translate(0, 0, baseThicknessMm / 2);
  return box;
}

// Rectangular base with a flat bottom and a cylindrically curved top. Curve
// axis is along Y; rolling direction is X. At the edges (x=±halfW) the top
// meets z = baseThicknessMm; at the center (x=0) it bulges up by `bulgeMax`.
function buildRockerBaseGeometry(opts) {
  const { widthMm, depthMm, baseThicknessMm, rollingRadiusMm } = opts;
  const R = rollingRadiusMm;
  const halfW = widthMm / 2;
  const halfD = depthMm / 2;
  const N = 48;
  const bulgeMax = R - Math.sqrt(R * R - halfW * halfW);

  const xs = new Float32Array(N + 1);
  const zTops = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const x = -halfW + (i / N) * widthMm;
    xs[i] = x;
    zTops[i] = baseThicknessMm + bulgeMax - (R - Math.sqrt(R * R - x * x));
  }

  const positions = [];
  const tri = (a, b, c, d, e, f, g, h, i) =>
    positions.push(a, b, c, d, e, f, g, h, i);

  // Curved top (+Z normal)
  for (let i = 0; i < N; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const z0 = zTops[i], z1 = zTops[i + 1];
    tri(x0, -halfD, z0, x1, -halfD, z1, x1, halfD, z1);
    tri(x0, -halfD, z0, x1, halfD, z1, x0, halfD, z0);
  }
  // Flat bottom (-Z)
  tri(-halfW, -halfD, 0, halfW, halfD, 0, halfW, -halfD, 0);
  tri(-halfW, -halfD, 0, -halfW, halfD, 0, halfW, halfD, 0);
  // Front face (-Y), profile-shaped trapezoid strips
  for (let i = 0; i < N; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const z0 = zTops[i], z1 = zTops[i + 1];
    tri(x0, -halfD, 0, x1, -halfD, 0, x1, -halfD, z1);
    tri(x0, -halfD, 0, x1, -halfD, z1, x0, -halfD, z0);
  }
  // Back face (+Y), reversed winding
  for (let i = 0; i < N; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const z0 = zTops[i], z1 = zTops[i + 1];
    tri(x0, halfD, 0, x1, halfD, z1, x1, halfD, 0);
    tri(x0, halfD, 0, x0, halfD, z0, x1, halfD, z1);
  }
  // Left end (-X), single quad up to baseThickness (offset is 0 at the edge)
  tri(-halfW, -halfD, 0, -halfW, halfD, baseThicknessMm, -halfW, halfD, 0);
  tri(-halfW, -halfD, 0, -halfW, -halfD, baseThicknessMm, -halfW, halfD, baseThicknessMm);
  // Right end (+X)
  tri(halfW, -halfD, 0, halfW, halfD, 0, halfW, halfD, baseThicknessMm);
  tri(halfW, -halfD, 0, halfW, halfD, baseThicknessMm, halfW, -halfD, baseThicknessMm);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geom;
}

// Bend the relief vertically so it follows the rocker top. Each vertex is
// shifted in +Z by the bulge offset at its X coordinate, so the relief height
// stays uniform and the bottom of every line sits flush on the curve.
function applyRollingCurveToPattern(geometry, opts) {
  const { rollingEnabled, rollingRadiusMm, widthMm } = opts;
  const halfW = widthMm / 2;
  if (!rollingEnabled || !rollingRadiusMm || rollingRadiusMm < halfW) return;
  const R = rollingRadiusMm;
  const bulgeMax = R - Math.sqrt(R * R - halfW * halfW);
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const cx = Math.max(-halfW, Math.min(halfW, x));
    const offset = bulgeMax - (R - Math.sqrt(R * R - cx * cx));
    pos.setZ(i, pos.getZ(i) + offset);
  }
  pos.needsUpdate = true;
}

// Handle, built bottom-up of two pieces stacked along -Z:
//   1. Conical transition (height = handleHeightMm) from baseRadius (touching
//      the base) down to handleRadiusMm (grip).
//   2. Optional cylindrical grip (height = handleGripHeightMm, same radius)
//      below the cone. Skipped if grip height is 0.
function buildHandleGeometry(opts) {
  const {
    handleRadiusMm,
    handleHeightMm,
    handleTransitionAngleDeg,
    handleGripHeightMm = 0,
  } = opts;
  const tan = Math.tan(((handleTransitionAngleDeg ?? 0) * Math.PI) / 180);
  const baseRadius = handleRadiusMm + handleHeightMm * Math.max(0, tan);
  const overlap = 0.2; // bury joints so slicers union cleanly

  const pieces = [];

  // Cone: wide end at z = +overlap/2 (inside the base), narrow end at
  // z = -handleHeightMm - overlap/2.
  const coneH = handleHeightMm + overlap;
  const cone = new THREE.CylinderGeometry(handleRadiusMm, baseRadius, coneH, 64, 1);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0, overlap / 2 - coneH / 2);
  pieces.push(cone);

  // Grip cylinder: top overlaps the cone's narrow end, bottom sits at
  // z = -handleHeightMm - handleGripHeightMm.
  if (handleGripHeightMm > 0) {
    const gripH = handleGripHeightMm + overlap;
    const grip = new THREE.CylinderGeometry(handleRadiusMm, handleRadiusMm, gripH, 64, 1);
    grip.rotateX(-Math.PI / 2);
    grip.translate(0, 0, -handleHeightMm - handleGripHeightMm / 2);
    pieces.push(grip);
  }

  return pieces;
}
