import type { Vec, Poly, Region } from './types.ts';
import type { Rng } from './rng.ts';

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const norm = (a: Vec): Vec => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Left-hand perpendicular (rotates +90°). */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

/**
 * Heading convention: angle 0 points "up the hole" (+Y), positive angles turn right (+X).
 * So dirFromHeading(h) = (sin h, cos h).
 */
export const dirFromHeading = (h: number): Vec => ({ x: Math.sin(h), y: Math.cos(h) });
export const headingOf = (d: Vec) => Math.atan2(d.x, d.y);

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const roundVec = (p: Vec): Vec => ({ x: round1(p.x), y: round1(p.y) });
export const roundPoly = (p: Poly): Poly => p.map(roundVec);

export function pointInPoly(p: Vec, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInRegion(p: Vec, r: Region): boolean {
  if (!pointInPoly(p, r.outer)) return false;
  return !(r.holes ?? []).some((h) => pointInPoly(p, h));
}

export function segDist(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { d: dist(p, add(a, scale(ab, t))), t };
}

export function distToPolyEdge(p: Vec, poly: Poly): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, segDist(p, poly[j], poly[i]).d);
  }
  return best;
}

export function polyCentroid(poly: Poly): Vec {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

export function polysOverlap(a: Poly, b: Poly, margin = 0): boolean {
  if (a.some((p) => pointInPoly(p, b)) || b.some((p) => pointInPoly(p, a))) return true;
  if (margin > 0) {
    return a.some((p) => distToPolyEdge(p, b) < margin) || b.some((p) => distToPolyEdge(p, a) < margin);
  }
  return false;
}

/**
 * Organic blob: an ellipse (rx across, ry along `heading`) whose radius is
 * perturbed by a few low-frequency harmonics. Used for greens, bunkers, ponds.
 */
export function blob(
  rng: Rng,
  center: Vec,
  rx: number,
  ry: number,
  heading: number,
  wobble = 0.15,
  points = 28,
): Poly {
  const harmonics = [2, 3, 4, 5].map((k) => ({
    k,
    amp: rng.range(0, wobble) / (k * 0.6),
    phase: rng.range(0, Math.PI * 2),
  }));
  const fwd = dirFromHeading(heading);
  const side = perp(fwd);
  const out: Poly = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    let r = 1;
    for (const h of harmonics) r += h.amp * Math.sin(h.k * a + h.phase);
    const lx = Math.cos(a) * rx * r;
    const ly = Math.sin(a) * ry * r;
    out.push(add(center, add(scale(side, -lx), scale(fwd, ly))));
  }
  return out;
}

/** Bounding box of a set of points. */
export function bounds(points: Vec[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Uniform Catmull-Rom spline through `pts`, densely sampled then resampled at fixed spacing. */
export function catmullRomResample(pts: Vec[], spacing: number): Vec[] {
  if (pts.length < 2) return pts.slice();
  const dense: Vec[] = [];
  const P = (i: number) => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  dense.push(pts[pts.length - 1]);

  const out: Vec[] = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    let a = dense[i - 1];
    const b = dense[i];
    let segLen = dist(a, b);
    while (carry + segLen >= spacing) {
      const t = (spacing - carry) / segLen;
      const p = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
      out.push(p);
      a = p;
      segLen = dist(a, b);
      carry = 0;
    }
    carry += segLen;
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > spacing * 0.3) out.push(pts[pts.length - 1]);
  else out[out.length - 1] = pts[pts.length - 1];
  return out;
}

function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o = (p: Vec, q: Vec, r: Vec) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** True if the polygon's edges never cross each other (no bow-ties or folded strips). */
export function isSimplePolygon(poly: Poly): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent via wrap-around
      if (segmentsCross(a, b, poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}
