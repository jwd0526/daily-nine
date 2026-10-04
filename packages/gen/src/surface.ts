// Single source of truth for "what is the ground at point p?".
// Physics, the validator bot and the renderer all go through here.

import type { Bump, Hole, Surface, Vec, Centerline, GreenSlope } from './types.ts';
import { fairwayWidthAt } from './centerline.ts';
import { dist, distToPolyEdge, lerp, pointInPoly, pointInRegion, segDist, dirFromHeading, dot, sub, perp } from './geom.ts';

export interface CenterlineHit {
  /** Arc length of the closest point. */
  s: number;
  /** Distance from the centerline. */
  d: number;
  /** Fairway half-width there. */
  w: number;
  /** Corridor (OB) half-width there. */
  ob: number;
  /** Signed lateral offset from the centerline (positive = right of travel). */
  lat: number;
  /** Fairway center offset there. */
  fo: number;
}

export function nearestOnCenterline(c: Centerline, p: Vec): CenterlineHit {
  let best: CenterlineHit = { s: 0, d: Infinity, w: c.w[0], ob: c.ob[0], lat: 0, fo: 0 };
  let bi = 0;
  for (let i = 0; i < c.pts.length - 1; i++) {
    const { d, t } = segDist(p, c.pts[i], c.pts[i + 1]);
    if (d < best.d) {
      bi = i;
      best = {
        s: lerp(c.s[i], c.s[i + 1], t),
        d,
        w: lerp(c.w[i], c.w[i + 1], t),
        ob: lerp(c.ob[i], c.ob[i + 1], t),
        lat: 0,
        fo: c.fo ? lerp(c.fo[i], c.fo[i + 1], t) : 0,
      };
    }
  }
  // Sign the distance: positive when p is right of the direction of travel.
  const a = c.pts[bi], b = c.pts[bi + 1];
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  best.lat = cross > 0 ? -best.d : best.d;
  return best;
}

/** Radius beyond the green edge that is always in play (rough apron around the green). */
export const GREEN_APRON = 15;
/** Tee box half-size (across, along). */
export const TEE_BOX = { hw: 5, hl: 4 };

export function inTeeBox(hole: Hole, p: Vec): boolean {
  const fwd = dirFromHeading(hole.teeHeading);
  const rel = sub(p, hole.tee);
  return Math.abs(dot(rel, fwd)) <= TEE_BOX.hl && Math.abs(dot(rel, perp(fwd))) <= TEE_BOX.hw;
}

export function inPlayCorridor(hole: Hole, p: Vec, hit = nearestOnCenterline(hole.centerline, p)): boolean {
  if (hit.d <= hit.ob) return true;
  return distToPolyEdge(p, hole.green.poly) < GREEN_APRON || pointInPoly(p, hole.green.poly);
}

export function surfaceAt(hole: Hole, p: Vec): Surface {
  if (inTeeBox(hole, p)) return 'tee';
  if (pointInPoly(p, hole.green.poly)) return 'green';
  const edge = distToPolyEdge(p, hole.green.poly);
  if (edge <= hole.fringeWidth) return 'fringe';
  for (const b of hole.bunkers) if (pointInPoly(p, b)) return 'bunker';
  for (const w of hole.water) if (pointInRegion(p, w)) return 'water';
  for (const w of hole.waste ?? []) if (pointInPoly(p, w)) return 'waste';

  const hit = nearestOnCenterline(hole.centerline, p);
  if (!inPlayCorridor(hole, p, hit)) return 'ob';

  for (const t of hole.trees) {
    if (dist(p, t) < t.r * 0.85) return 'trees';
  }
  if (onFairway(hole, hit)) return 'fairway';
  return 'rough';
}

/** Whether a centerline hit falls on mown fairway (allowing for meander and carry gaps). */
export function onFairway(hole: Hole, hit: CenterlineHit): boolean {
  return Math.abs(hit.lat - hit.fo) <= fairwayWidthAt(hole, hit.s, hit.w);
}

/** Height of the green surface (for putting break). Zero off the green. */
export function greenHeight(hole: Hole, p: Vec): number {
  return slopeHeight(hole.green.slope, hole.green.center, p);
}

/** Height of a green surface described by `slope`, relative to its center `c`. */
export function slopeHeight(slope: GreenSlope, c: Vec, p: Vec): number {
  const { gx, gy, bumps, tiers = [], waves = [] } = slope;
  let h = gx * (p.x - c.x) + gy * (p.y - c.y) + bumpsHeight(bumps, p);
  for (const t of tiers) {
    const n = (p.x - t.x) * Math.sin(t.dir) + (p.y - t.y) * Math.cos(t.dir);
    h += t.h * 0.5 * (1 + Math.tanh(n / t.w));
  }
  for (const w of waves) h += w.a * Math.sin(w.kx * p.x + w.ky * p.y + w.ph);
  return h;
}

function bumpsHeight(bumps: Bump[], p: Vec): number {
  let h = 0;
  for (const b of bumps) {
    const dx = p.x - b.x, dy = p.y - b.y;
    const rot = b.rot ?? 0;
    // Local frame: "along" follows the ridge heading, "across" is perpendicular.
    const along = dx * Math.sin(rot) + dy * Math.cos(rot);
    const across = dx * Math.cos(rot) - dy * Math.sin(rot);
    const d2 = (along / (b.r * (b.sx ?? 1))) ** 2 + (across / b.r) ** 2;
    h += b.h * Math.exp(-d2);
  }
  return h;
}

/** central-difference gradient (rise per yard) of a height function */
function gradientOf(height: (p: Vec) => number, p: Vec): Vec {
  const e = 0.25;
  return {
    x: (height({ x: p.x + e, y: p.y }) - height({ x: p.x - e, y: p.y })) / (2 * e),
    y: (height({ x: p.x, y: p.y + e }) - height({ x: p.x, y: p.y - e })) / (2 * e),
  };
}

/** Gradient of the green height (rise per yard). */
export function greenGradient(hole: Hole, p: Vec): Vec {
  return gradientOf((q) => greenHeight(hole, q), p);
}

/** yards beyond the green's edge over which fairway contours fade in, so they never fight the green's own slope */
const CONTOUR_FADE = 8;

/** height of the ground off the green from fairway contours (0 on the green itself) */
export function terrainHeight(hole: Hole, p: Vec): number {
  // most of the hole is nowhere near a contour: skip the green-edge math there
  const near = hole.contours.some((b) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y) < 4 * b.r * Math.max(1, b.sx ?? 1));
  if (!near || pointInPoly(p, hole.green.poly)) return 0;
  const fade = Math.min(1, Math.max(0, (distToPolyEdge(p, hole.green.poly) - 1) / CONTOUR_FADE));
  return fade === 0 ? 0 : bumpsHeight(hole.contours, p) * fade;
}

/** Gradient of the contour terrain (rise per yard). */
export function terrainGradient(hole: Hole, p: Vec): Vec {
  return gradientOf((q) => terrainHeight(hole, q), p);
}
