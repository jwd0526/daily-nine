import type { Centerline, Hole, Vec } from './types.ts';
import { headingOf, lerp, norm, sub } from './geom.ts';

export interface Frame {
  p: Vec;
  /** Unit vector down the hole. */
  fwd: Vec;
  /** Unit vector to the right of travel. */
  right: Vec;
  heading: number;
  w: number;
  ob: number;
  /** Fairway center offset from the centerline (positive = right). */
  fo: number;
}

/** Position, direction and widths at arc length `s` (clamped to the line). */
export function frameAt(c: Centerline, s: number): Frame {
  const n = c.pts.length;
  const total = c.s[n - 1];
  const sc = Math.max(0, Math.min(total, s));
  let i = 0;
  while (i < n - 2 && c.s[i + 1] < sc) i++;
  const seg = c.s[i + 1] - c.s[i] || 1;
  const t = (sc - c.s[i]) / seg;
  const a = c.pts[i], b = c.pts[i + 1];
  const fwd = norm(sub(b, a));
  const extra = s - sc; // extrapolate past the ends
  return {
    p: { x: lerp(a.x, b.x, t) + fwd.x * extra, y: lerp(a.y, b.y, t) + fwd.y * extra },
    fwd,
    right: { x: fwd.y, y: -fwd.x },
    heading: headingOf(fwd),
    w: lerp(c.w[i], c.w[i + 1], t),
    ob: lerp(c.ob[i], c.ob[i + 1], t),
    fo: c.fo ? lerp(c.fo[i], c.fo[i + 1], t) : 0,
  };
}

/** Point on the fairway's own center line at arc length s, plus a lateral offset from it. */
export function fairwayPoint(c: Centerline, s: number, lateral = 0): Vec {
  const f = frameAt(c, s);
  return { x: f.p.x + f.right.x * (f.fo + lateral), y: f.p.y + f.right.y * (f.fo + lateral) };
}

/** Length (yards) over which a fairway narrows to a rounded nose at each end of a segment. */
export const FAIRWAY_NOSE = 13;

/**
 * Fairway half-width at arc length s, after rounding off the ends of each fairway segment
 * (an elliptical nose rather than a square cut). Zero where there's no fairway.
 */
export function fairwayWidthAt(hole: Pick<Hole, 'fairwayStart' | 'fairwayEnd' | 'fairwayGaps'>, s: number, w: number): number {
  for (const [a, b] of fairwaySegments(hole)) {
    if (s < a || s > b) continue;
    const nose = Math.min(FAIRWAY_NOSE, (b - a) / 2);
    const t = Math.min(1, Math.min(s - a, b - s) / nose);
    return w * Math.sqrt(1 - (1 - t) * (1 - t));
  }
  return 0;
}

/** Arc-length ranges actually covered by fairway (the main span minus any carry gaps). */
export function fairwaySegments(hole: Pick<Hole, 'fairwayStart' | 'fairwayEnd' | 'fairwayGaps'>): [number, number][] {
  let segs: [number, number][] = hole.fairwayStart < hole.fairwayEnd ? [[hole.fairwayStart, hole.fairwayEnd]] : [];
  for (const [g0, g1] of hole.fairwayGaps ?? []) {
    segs = segs.flatMap(([a, b]): [number, number][] => {
      if (g1 <= a || g0 >= b) return [[a, b]];
      const out: [number, number][] = [];
      if (g0 > a) out.push([a, g0]);
      if (g1 < b) out.push([g1, b]);
      return out;
    });
  }
  return segs;
}

/** Point at arc length s, offset laterally (positive = right of travel). */
export function offsetAt(c: Centerline, s: number, lateral: number): Vec {
  const f = frameAt(c, s);
  return { x: f.p.x + f.right.x * lateral, y: f.p.y + f.right.y * lateral };
}

export function totalLength(c: Centerline): number {
  return c.s[c.s.length - 1];
}

export function arcLengths(pts: Vec[]): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return s;
}

