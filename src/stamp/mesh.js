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
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { traceShapes } from './tracer.js';

// Edge length, in mm, used when subdividing the relief before bending it onto
// the rocker curve. Smaller = smoother curve but more triangles. 0.5 mm is
// well below typical 3D-printer layer heights so faceting won't be visible.
const ROLLING_TESSELLATE_EDGE_MM = 0.5;

export function buildStampGeometry(masks, opts) {
  const geoms = [];
  const effW = effectiveWidthMm(opts);

  const pattern = buildPatternGeometry(masks, opts);
  if (pattern) {
    let final = pattern;
    // Rolling mode bends the relief onto a curve — long flat triangles would
    // fly above or below the curve between their vertices, producing facets in
    // the print. Subdivide first so every edge stays short enough to conform.
    if (opts.rollingEnabled && opts.rollingRadiusMm >= opts.widthMm / 2) {
      final = new TessellateModifier(ROLLING_TESSELLATE_EDGE_MM, 8).modify(pattern);
      if (final !== pattern) pattern.dispose();
    }
    applyRollingCurveToPattern(final, opts, effW);
    geoms.push(final);
  }

  geoms.push(buildBaseGeometry(opts, effW));

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
    draftAngleDeg = 0,
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
    curveSegments: 12,
  });
  applyDraftAngle(geo, draftAngleDeg, reliefDepthMm);
  geo.translate(0, 0, baseThicknessMm);
  return geo;
}

// Inset the top of each extruded wall toward the polygon interior so the
// stamp releases cleanly from clay. Walls become trapezoids: wider at the
// base (z=0), narrower at the top (z=reliefDepth) by `reliefDepth*tan(deg)`.
//
// We group every top-z vertex by its XY position and use the side-wall
// vertices' outward 2D normals (which ExtrudeGeometry has just computed) as
// the local "outward" direction. Top-cap duplicates at the same XY get
// shifted by the same vector so the mesh stays watertight. Corner vertices
// naturally get the average of their two adjacent edge normals — the right
// direction for a corner inset.
function applyDraftAngle(geometry, draftAngleDeg, reliefDepth) {
  if (!draftAngleDeg || draftAngleDeg <= 0) return;
  const offset = reliefDepth * Math.tan((draftAngleDeg * Math.PI) / 180);
  if (offset <= 0) return;

  const pos = geometry.getAttribute('position');
  const norm = geometry.getAttribute('normal');
  if (!norm) return;

  const eps = 1e-3;
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getZ(i) - reliefDepth) > 1e-4) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const key = `${Math.round(x / eps)}_${Math.round(y / eps)}`;
    let g = groups.get(key);
    if (!g) {
      g = { indices: [], nx: 0, ny: 0 };
      groups.set(key, g);
    }
    g.indices.push(i);
    // Side-wall normals lie in the XY plane (|nz| ~ 0); top-cap normals are
    // (0,0,1). Only the side-wall ones tell us which way is "outward".
    if (Math.abs(norm.getZ(i)) < 0.5) {
      g.nx += norm.getX(i);
      g.ny += norm.getY(i);
    }
  }

  for (const g of groups.values()) {
    const len = Math.hypot(g.nx, g.ny);
    if (len < 1e-6) continue;
    const dx = (g.nx / len) * offset;
    const dy = (g.ny / len) * offset;
    for (const i of g.indices) {
      pos.setX(i, pos.getX(i) - dx);
      pos.setY(i, pos.getY(i) - dy);
    }
  }
  pos.needsUpdate = true;
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

// Effective chord-width of the curved top. When flat-roll compensation is on,
// we shrink the chord so the *arc length* of the curve equals the user's
// design widthMm — meaning a roll across flat clay imprints at exactly
// widthMm wide, not arc-stretched. Otherwise returns widthMm unchanged.
function effectiveWidthMm(opts) {
  const { rollingEnabled, rollingFlatCompensate, rollingRadiusMm, widthMm } = opts;
  if (!rollingEnabled || !rollingFlatCompensate) return widthMm;
  if (!rollingRadiusMm || rollingRadiusMm < widthMm / 2) return widthMm;
  return 2 * rollingRadiusMm * Math.sin(widthMm / (2 * rollingRadiusMm));
}

function buildBaseGeometry(opts, effW) {
  const { shape, widthMm, depthMm, baseThicknessMm, rollingRadiusMm = 0 } = opts;

  // Rolling mode overrides the shape: a rocker (flat bottom, cylindrically
  // curved top) is the only shape that rolls coherently.
  if (opts.rollingEnabled && rollingRadiusMm >= widthMm / 2) {
    return buildRockerBaseGeometry(opts, effW);
  }
  if (shape === 'round') {
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, baseThicknessMm, 192, 1);
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
function buildRockerBaseGeometry(opts, effW) {
  const { depthMm, baseThicknessMm, rollingRadiusMm } = opts;
  const R = rollingRadiusMm;
  const halfW = effW / 2;
  const halfD = depthMm / 2;
  const N = 256;
  const bulgeMax = R - Math.sqrt(R * R - halfW * halfW);

  const xs = new Float32Array(N + 1);
  const zTops = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const x = -halfW + (i / N) * effW;
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
//
// When flat-roll compensation is enabled, each vertex's X is first remapped
// from design-X to chord-X via  x → R·sin(x/R). The relief footprint shrinks
// to the chord width (matching the rocker), but the *arc length* still equals
// the design width — so rolling the stamp across flat clay imprints at true
// design size, no stretch.
function applyRollingCurveToPattern(geometry, opts, effW) {
  const { rollingEnabled, rollingRadiusMm, widthMm, rollingFlatCompensate } = opts;
  if (!rollingEnabled || !rollingRadiusMm || rollingRadiusMm < widthMm / 2) return;
  const R = rollingRadiusMm;
  const halfW = effW / 2;
  const bulgeMax = R - Math.sqrt(R * R - halfW * halfW);
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    if (rollingFlatCompensate) {
      x = R * Math.sin(x / R);
      pos.setX(i, x);
    }
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
  const cone = new THREE.CylinderGeometry(handleRadiusMm, baseRadius, coneH, 128, 1);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0, overlap / 2 - coneH / 2);
  pieces.push(cone);

  // Grip cylinder: top overlaps the cone's narrow end, bottom sits at
  // z = -handleHeightMm - handleGripHeightMm.
  if (handleGripHeightMm > 0) {
    const gripH = handleGripHeightMm + overlap;
    const grip = new THREE.CylinderGeometry(handleRadiusMm, handleRadiusMm, gripH, 128, 1);
    grip.rotateX(-Math.PI / 2);
    grip.translate(0, 0, -handleHeightMm - handleGripHeightMm / 2);
    pieces.push(grip);
  }

  return pieces;
}
