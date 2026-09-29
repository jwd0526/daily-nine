// Hole features: every hazard is a pluggable HoleFeature placed into "design slots"
// (dogleg corner, landing-zone flank, carry band, greenside...). Adding a new feature
// (e.g. arcade modifiers later) means writing one object and registering it here.

import type { Biome, Poly, Region, Vec } from './types.ts';
import type { Rng } from './rng.ts';
import type { HoleContext, HoleDraft } from './hole.ts';
import {
  add, blob, dirFromHeading, dist, distToPolyEdge, isSimplePolygon, lerp, pointInPoly, polysOverlap,
  roundPoly, roundVec, scale,
} from './geom.ts';
import { fairwayPoint, frameAt } from './centerline.ts';
import { nearestOnCenterline } from './surface.ts';

const DEG = Math.PI / 180;

/** Course-wide limits shared across holes (copied per attempt, committed on success). */
export interface CourseBudget {
  islandUsed: boolean;
  waterHoles: number;
  maxWaterHoles: number;
  /** How many holes already use each feature, to keep the round varied. */
  used: Record<string, number>;
}

export function copyBudget(b: CourseBudget): CourseBudget {
  return { ...b, used: { ...b.used } };
}

export interface FeatureCtx {
  hole: HoleDraft;
  ctx: HoleContext;
  rng: Rng;
}

export interface HoleFeature {
  id: string;
  /** Short UI chip shown on the hole card, e.g. "ISLAND". */
  tag?: string;
  /** At most one feature per group per hole. */
  group: string;
  /** Groups this feature rules out on the same hole. */
  excludes?: string[];
  /** Counts toward the course's water-hole budget. */
  water?: boolean;
  eligible(f: FeatureCtx): boolean;
  weight(f: FeatureCtx): number;
  /** Mutates the draft. Returns false if no valid placement was found. */
  apply(f: FeatureCtx): boolean;
}

const WATER_AFFINITY: Record<Biome, number> = { links: 1.1, parkland: 1.4, heath: 0.8, desert: 0.5, alpine: 1.0 };
const SAND_AFFINITY: Record<Biome, number> = { links: 1.4, parkland: 1, heath: 1.1, desert: 1.3, alpine: 0.8 };
const WASTE_AFFINITY: Record<Biome, number> = { links: 0.8, parkland: 0.1, heath: 1.2, desert: 2.2, alpine: 0.3 };
const POT_AFFINITY: Record<Biome, number> = { links: 2.2, parkland: 0.2, heath: 0.9, desert: 0.3, alpine: 0.3 };

/** Bodies of water must stay at least this far apart (no merged or touching lakes). */
const WATER_GAP = 10;

const waterW = (f: FeatureCtx) => WATER_AFFINITY[f.ctx.biome] * f.ctx.style.water;
const sandW = (f: FeatureCtx) => SAND_AFFINITY[f.ctx.biome] * f.ctx.style.sand;
const waterAllowed = (f: FeatureCtx) => f.ctx.budget.waterHoles < f.ctx.budget.maxWaterHoles;

// ---------------------------------------------------------------------------
// Placement guards

function clearOfGreen(h: HoleDraft, poly: Poly, margin: number) {
  return !polysOverlap(poly, h.green.poly, h.fringeWidth + margin);
}

function clearOfTee(h: HoleDraft, poly: Poly, r = 30) {
  return poly.every((p) => dist(p, h.tee) > r);
}

/** No overlap with bunkers, waste or water already on the hole. */
function clearOfHazards(h: HoleDraft, poly: Poly, margin = 3) {
  return (
    h.bunkers.every((b) => !polysOverlap(poly, b, margin)) &&
    (h.waste ?? []).every((w) => !polysOverlap(poly, w, margin)) &&
    h.water.every((w) => !polysOverlap(poly, w.outer, margin))
  );
}

/** Landing zones (on the fairway's center) stay safe: nothing within `r` yards. */
function clearOfLandingZones(h: HoleDraft, poly: Poly, r: number) {
  return h.skeleton.slice(1, -1).every((p) => !pointInPoly(p, poly) && distToPolyEdge(p, poly) > r);
}

function addBunker(h: HoleDraft, poly: Poly, greenMargin = 1): boolean {
  if (!clearOfGreen(h, poly, greenMargin) || !clearOfTee(h, poly) || !clearOfHazards(h, poly)) return false;
  if (!isSimplePolygon(poly)) return false;
  h.bunkers.push(roundPoly(poly));
  return true;
}

/** Water must be a clean shape and stay well apart from other water. */
function addWater(h: HoleDraft, region: Region, opts: { greenMargin: number; teeR: number; hazardMargin?: number }): boolean {
  const poly = region.outer;
  if (!isSimplePolygon(poly)) return false;
  if (!clearOfTee(h, poly, opts.teeR)) return false;
  if (opts.greenMargin >= 0 && !clearOfGreen(h, poly, opts.greenMargin)) return false;
  if (h.water.some((w) => polysOverlap(poly, w.outer, WATER_GAP))) return false;
  if (!h.bunkers.every((b) => !polysOverlap(poly, b, opts.hazardMargin ?? 3))) return false;
  if (!(h.waste ?? []).every((w) => !polysOverlap(poly, w, opts.hazardMargin ?? 3))) return false;
  h.water.push({ outer: roundPoly(poly), ...(region.holes ? { holes: region.holes.map(roundPoly) } : {}) });
  return true;
}

function addWaste(h: HoleDraft, poly: Poly): boolean {
  if (!isSimplePolygon(poly) || !clearOfGreen(h, poly, 4) || !clearOfTee(h, poly, 25) || !clearOfHazards(h, poly, 2)) return false;
  (h.waste ??= []).push(roundPoly(poly));
  return true;
}

/** Ray-cast from the green center to its edge along a heading. */
function greenEdgeDist(h: HoleDraft, heading: number): number {
  const d = dirFromHeading(heading);
  let r = 0;
  while (r < 40 && pointInPoly(add(h.green.center, scale(d, r)), h.green.poly)) r += 0.5;
  return r;
}

function approachHeading(h: HoleDraft) {
  return frameAt(h.centerline, h.L - 10).heading;
}

/** A point beside the fairway edge at arc length s: side ±1, `extra` yards beyond the edge. */
function besideFairway(h: HoleDraft, s: number, side: number, extra: number): Vec {
  return fairwayPoint(h.centerline, s, side * (frameAt(h.centerline, s).w + extra));
}

/** How far into the fairway a polygon reaches, as a fraction of fairway half-width (0 = edge, 1 = center). */
function fairwayIntrusion(h: HoleDraft, poly: Poly): number {
  let worst = 0;
  for (const p of poly) {
    const hit = nearestOnCenterline(h.centerline, p);
    const off = Math.abs(hit.lat - hit.fo);
    if (off < hit.w) worst = Math.max(worst, 1 - off / hit.w);
  }
  return worst;
}

/** A strip polygon following a line, `halfWidth(i)` either side. */
function stripPoly(line: Vec[], halfWidth: (i: number) => number): Poly {
  const left: Vec[] = [], right: Vec[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / l, y: dx / l };
    const hw = halfWidth(i);
    left.push(add(line[i], scale(n, hw)));
    right.push(add(line[i], scale(n, -hw)));
  }
  return [...left, ...right.reverse()];
}

/** Arc-length windows clear of landing zones and the green, where carry hazards can go. */
function carryWindows(h: HoleDraft, lzClear: number, greenClear: number, teeMin: number): [number, number][] {
  const out: [number, number][] = [];
  const lz = h.lzS;
  if (lz.length && lz[0] - lzClear > teeMin) out.push([teeMin, lz[0] - lzClear]);
  for (let i = 0; i < lz.length; i++) {
    const next = i + 1 < lz.length ? lz[i + 1] - lzClear : h.L - h.greenR - greenClear;
    if (next - (lz[i] + lzClear) > 12) out.push([lz[i] + lzClear, next]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sand

const greenside: HoleFeature = {
  id: 'greenside-bunkers',
  group: 'greenside',
  eligible: () => true,
  weight: (f) => 5 * sandW(f),
  apply({ hole, ctx, rng }) {
    const count = Math.min(4, 1 + Math.round(ctx.difficulty * 2 * ctx.style.sand + rng.range(-0.6, 0.8)));
    const fwd = approachHeading(hole);
    // Angles relative to the approach: 0 = long, ±90 = sides, ±180 = short (front).
    const candidates = [-150, -110, -75, -40, 40, 75, 110, 150, 0];
    if (ctx.difficulty > 0.55) candidates.push(180, 165, -165);
    rng.shuffle(candidates);
    const used: number[] = [];
    for (const a of candidates) {
      if (used.length >= count) break;
      if (used.some((u) => Math.abs(((a - u + 540) % 360) - 180) < 50)) continue; // keep ≥50° apart
      const heading = fwd + (a + rng.range(-10, 10)) * DEG;
      const edge = greenEdgeDist(hole, heading);
      const rx = rng.range(4.5, 8);
      const ry = rng.range(2.5, 4.5);
      const center = add(hole.green.center, scale(dirFromHeading(heading), edge + hole.fringeWidth + ry * 1.25 + rng.range(1.5, 3)));
      const poly = blob(rng, center, rx, ry, heading + 90 * DEG, 0.25, 22);
      if (addBunker(hole, poly, 0.5)) used.push(a);
    }
    return used.length > 0;
  },
};

const fairwayBunker: HoleFeature = {
  id: 'fairway-bunker',
  group: 'flank',
  eligible: ({ hole }) => hole.par !== 3,
  weight: (f) => (1.5 + 2 * f.ctx.difficulty) * sandW(f),
  apply({ hole, rng }) {
    const i = rng.int(0, hole.lzS.length - 1);
    const bend = hole.bends.find((b) => Math.abs(b.s - hole.lzS[i]) < 40)?.angle ?? 0;
    // Catch the ball that runs through the outside of the turn, or a random side when straight.
    const side = Math.abs(bend) > 8 * DEG ? -Math.sign(bend) : rng.sign();
    for (let k = 0; k < 6; k++) {
      const s = hole.lzS[i] + rng.range(-5, 25);
      const f = frameAt(hole.centerline, s);
      const center = besideFairway(hole, s, side, rng.range(-2, 3));
      const poly = blob(rng, center, rng.range(3.5, 5.5), rng.range(6, 10), f.heading, 0.25, 22);
      if (!clearOfLandingZones(hole, poly, 6)) continue;
      if (addBunker(hole, poly)) {
        if (rng.chance(0.4)) {
          const s2 = s + rng.range(14, 22);
          addBunker(hole, blob(rng, besideFairway(hole, s2, side, rng.range(0, 5)), rng.range(3, 4.5), rng.range(4, 7), f.heading, 0.25, 20));
        }
        return true;
      }
    }
    return false;
  },
};

/** A bunker sitting in the middle of the fairway past the landing zone: go left or right of it. */
const centerBunker: HoleFeature = {
  id: 'center-bunker',
  group: 'center',
  eligible: ({ hole }) => hole.par !== 3 && hole.L - hole.lzS[0] > 130,
  weight: (f) => (0.3 + 0.8 * f.ctx.difficulty) * sandW(f),
  apply({ hole, rng }) {
    for (let k = 0; k < 6; k++) {
      const s = hole.lzS[0] + rng.range(35, 65);
      if (s > hole.L - 60) return false;
      const f = frameAt(hole.centerline, s);
      const poly = blob(rng, fairwayPoint(hole.centerline, s, rng.range(-3, 3)), rng.range(3.5, 5), rng.range(4, 7), f.heading, 0.25, 22);
      if (clearOfLandingZones(hole, poly, 20) && addBunker(hole, poly)) return true;
    }
    return false;
  },
};

/** Small, deep pot bunkers scattered around the landing area (classic links). */
const potBunkers: HoleFeature = {
  id: 'pot-bunkers',
  group: 'pots',
  eligible: ({ hole }) => hole.par !== 3,
  weight: (f) => POT_AFFINITY[f.ctx.biome] * f.ctx.style.sand * (0.5 + f.ctx.difficulty),
  apply({ hole, rng }) {
    const n = rng.int(3, 6);
    let placed = 0;
    for (let k = 0; k < n * 4 && placed < n; k++) {
      const z = hole.lzS[rng.int(0, hole.lzS.length - 1)];
      const s = z + rng.range(-55, 70);
      if (s < 60 || s > hole.L - 30) continue;
      const w = frameAt(hole.centerline, s).w;
      const poly = blob(rng, fairwayPoint(hole.centerline, s, rng.range(-w - 6, w + 6)), rng.range(1.8, 2.8), rng.range(1.8, 2.8), 0, 0.15, 14);
      if (!clearOfLandingZones(hole, poly, 11)) continue;
      if (addBunker(hole, poly)) placed++;
    }
    return placed >= 2;
  },
};

/** Inside of a dogleg: punishes cutting the corner too aggressively. */
function cornerFeature(kind: 'bunker' | 'water'): HoleFeature {
  return {
    id: `corner-${kind}`,
    group: 'corner',
    water: kind === 'water',
    eligible: (f) =>
      f.hole.bends.some((b) => Math.abs(b.angle) > 14 * DEG) && (kind === 'bunker' || waterAllowed(f)),
    weight: (f) => (kind === 'water' ? 1.2 * waterW(f) : 2 * sandW(f)) * (0.6 + f.ctx.difficulty),
    apply({ hole, rng }) {
      const bend = hole.bends.find((b) => Math.abs(b.angle) > 14 * DEG)!;
      const inside = Math.sign(bend.angle);
      for (let k = 0; k < 8; k++) {
        const s = bend.s - rng.range(15, 45);
        const f = frameAt(hole.centerline, s);
        const r = kind === 'water' ? rng.range(12, 20) : rng.range(5, 8);
        const center = besideFairway(hole, s, inside, r * 0.8 + rng.range(1, 5));
        const poly = blob(rng, center, r, r * rng.range(1, 1.6), f.heading, 0.2, 26);
        // Must not eat into the fairway much.
        if (fairwayIntrusion(hole, poly) > 0.35 || !clearOfLandingZones(hole, poly, 8)) continue;
        if (kind === 'bunker') {
          if (addBunker(hole, poly)) return true;
        } else if (addWater(hole, { outer: poly }, { greenMargin: 8, teeR: 30 })) {
          return true;
        }
      }
      return false;
    },
  };
}

/** Bunkers across the fairway short of the green: the approach must carry them. */
const crossBunkers: HoleFeature = {
  id: 'cross-bunkers',
  group: 'cross',
  eligible: ({ hole }) => hole.par !== 3 && hole.L - hole.lzS[hole.lzS.length - 1] > 120,
  weight: (f) => (0.6 + f.ctx.difficulty) * sandW(f),
  apply({ hole, rng }) {
    const lastLz = hole.lzS[hole.lzS.length - 1];
    const s = lerp(lastLz + 45, hole.L - 40, rng.range(0.2, 0.8));
    const f = frameAt(hole.centerline, s);
    const n = rng.int(2, 3);
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const lat = lerp(-f.w * 0.8, f.w * 0.8, n === 1 ? 0.5 : i / (n - 1)) + rng.range(-3, 3);
      const c = fairwayPoint(hole.centerline, s + lat * rng.range(-0.3, 0.3), lat);
      if (addBunker(hole, blob(rng, c, rng.range(4, 6.5), rng.range(2.5, 4), f.heading, 0.3, 20))) placed++;
    }
    return placed > 0;
  },
};

/** Sandy scrub running down one side of the fairway. */
const wasteFlank: HoleFeature = {
  id: 'waste-flank',
  tag: 'WASTE',
  group: 'waste',
  eligible: ({ hole }) => hole.L > 150,
  weight: (f) => 0.6 * WASTE_AFFINITY[f.ctx.biome] * f.ctx.style.sand * (0.6 + f.ctx.difficulty),
  apply({ hole, rng }) {
    for (let k = 0; k < 6; k++) {
      const side = rng.sign();
      const len = Math.min(hole.L * 0.55, rng.range(70, 170));
      const s0 = rng.range(50, Math.max(55, hole.L - len - 30));
      const s1 = s0 + len;
      const nIn = rng.noise1d(25), nOut = rng.noise1d(35);
      const depth = rng.range(14, 28);
      const inner: Vec[] = [], outer: Vec[] = [];
      for (let s = s0; s <= s1; s += 4) {
        // sqrt(sin) gives rounded, blunt ends rather than needle points.
        const taper = Math.sqrt(Math.sin(((s - s0) / (s1 - s0)) * Math.PI));
        // The outer edge always sits beyond the inner one, so the shape never folds.
        const innerX = 2 + (1 - taper) * 10 + nIn(s) * 3;
        inner.push(besideFairway(hole, s, side, innerX));
        outer.push(besideFairway(hole, s, side, innerX + 3 + taper * depth + Math.abs(nOut(s)) * 4));
      }
      const poly = [...inner, ...outer.reverse()];
      if (!clearOfLandingZones(hole, poly, 8)) continue;
      if (addWaste(hole, poly)) return true;
    }
    return false;
  },
};

/** A broad sandy band across the hole that the tee shot or approach must carry. */
const wasteCross: HoleFeature = {
  id: 'waste-cross',
  tag: 'WASTE',
  group: 'cross',
  eligible: ({ hole }) => hole.par !== 3,
  weight: (f) => WASTE_AFFINITY[f.ctx.biome] * f.ctx.style.sand * (0.3 + 0.6 * f.ctx.difficulty),
  apply({ hole, rng }) {
    const windows = carryWindows(hole, 30, 25, 100);
    if (!windows.length) return false;
    for (let k = 0; k < 6; k++) {
      const [a, b] = rng.pick(windows);
      const s = rng.range(a, b);
      const f = frameAt(hole.centerline, s);
      const across = dirFromHeading(f.heading + 90 * DEG + rng.range(-20, 20) * DEG);
      // A gently bowed band that stays inside the corridor and tapers to rounded ends.
      const reach = f.ob * rng.range(0.7, 0.95);
      const bow = rng.range(-8, 8);
      const line: Vec[] = [];
      for (let t = -reach; t <= reach; t += 3) {
        const u = t / reach;
        line.push(add(add(f.p, scale(across, t)), scale(f.fwd, bow * (1 - u * u))));
      }
      const hw = rng.range(6, 10);
      const n = rng.noise1d(10);
      const last = line.length - 1;
      const poly = stripPoly(line, (i) => (hw + n(i * 3) * 2) * Math.sqrt(Math.sin((i / last) * Math.PI)) + 0.3);
      if (!clearOfLandingZones(hole, poly, 20)) continue;
      if (addWaste(hole, poly)) return true;
    }
    return false;
  },
};

// ---------------------------------------------------------------------------
// Water

/** A burn: a stream crossing the whole corridor diagonally. Must sit outside landing zones. */
const burn: HoleFeature = {
  id: 'burn',
  tag: 'BURN',
  group: 'cross',
  water: true,
  eligible: (f) => f.hole.par !== 3 && waterAllowed(f),
  weight: (f) => (f.ctx.biome === 'links' || f.ctx.biome === 'heath' ? 2 : 1) * f.ctx.style.water * (0.5 + f.ctx.difficulty),
  apply({ hole, rng }) {
    const windows = carryWindows(hole, 40, 30, 110);
    if (!windows.length) return false;
    for (let k = 0; k < 6; k++) {
      const [a, b] = rng.pick(windows);
      const s = rng.range(a, b);
      const f = frameAt(hole.centerline, s);
      const skew = rng.range(-30, 30) * DEG;
      const across = dirFromHeading(f.heading + 90 * DEG + skew);
      const reach = f.ob + 30;
      const line: Vec[] = [];
      const phase = rng.range(0, 6);
      for (let t = -reach; t <= reach; t += 4) {
        const wiggle = Math.sin(t / 14 + phase) * 3;
        line.push(add(add(f.p, scale(across, t)), scale(f.fwd, wiggle)));
      }
      const hw = rng.range(2.5, 4);
      const poly = stripPoly(line, (i) => hw + Math.sin(i * 0.7 + phase) * 0.6);
      if (!clearOfLandingZones(hole, poly, 25)) continue;
      if (addWater(hole, { outer: poly }, { greenMargin: 18, teeR: 60, hazardMargin: 2 })) return true;
    }
    return false;
  },
};

/** Pond or shoreline running down one side of the hole. */
const lateralWater: HoleFeature = {
  id: 'lateral-water',
  group: 'water',
  water: true,
  eligible: (f) => f.hole.L > 160 && waterAllowed(f),
  weight: (f) => 1.4 * waterW(f) * (0.5 + f.ctx.difficulty),
  apply({ hole, rng }) {
    for (let k = 0; k < 6; k++) {
      const side = rng.sign();
      const len = Math.min(hole.L * 0.6, rng.range(80, 180));
      const s0 = rng.range(Math.max(70, hole.L * 0.25), Math.max(80, hole.L - len + 20));
      const s1 = s0 + len;
      const inner: Vec[] = [], outer: Vec[] = [];
      const nIn = rng.noise1d(30), nOut = rng.noise1d(40);
      const inset = rng.range(3, 8);
      const depth = rng.range(18, 34);
      for (let s = s0; s <= s1; s += 4) {
        // A self-contained pond: rounded ends, a wavy far shore, all of it in view.
        const taper = Math.sqrt(Math.sin(((s - s0) / (s1 - s0)) * Math.PI));
        const innerX = inset + (1 - taper) * 14 + nIn(s) * 3;
        inner.push(besideFairway(hole, s, side, innerX));
        outer.push(besideFairway(hole, s, side, innerX + 2 + taper * (depth + nOut(s) * 6)));
      }
      const poly = [...inner, ...outer.reverse()];
      if (!clearOfLandingZones(hole, poly, 10)) continue;
      if (addWater(hole, { outer: poly }, { greenMargin: 6, teeR: 40, hazardMargin: 2 })) return true;
    }
    return false;
  },
};

/** A narrow creek meandering alongside the fairway in the rough. */
const creek: HoleFeature = {
  id: 'creek',
  tag: 'CREEK',
  group: 'water',
  water: true,
  eligible: (f) => f.hole.L > 200 && waterAllowed(f),
  weight: (f) => (f.ctx.biome === 'parkland' || f.ctx.biome === 'alpine' ? 1.6 : 0.7) * f.ctx.style.water * (0.5 + f.ctx.difficulty),
  apply({ hole, rng }) {
    for (let k = 0; k < 6; k++) {
      const side = rng.sign();
      const len = Math.min(hole.L * 0.75, rng.range(110, 240));
      const s0 = rng.range(60, Math.max(65, hole.L - len - 25));
      const n = rng.noise1d(40);
      const line: Vec[] = [];
      for (let s = s0; s <= s0 + len; s += 4) line.push(besideFairway(hole, s, side, 7 + n(s) * 4));
      const hw = rng.range(1.6, 2.6);
      const last = line.length - 1;
      // Narrows at both ends so it seems to emerge and disappear rather than stop.
      const poly = stripPoly(line, (i) => 0.4 + hw * Math.sqrt(Math.sin((i / last) * Math.PI)));
      if (!clearOfLandingZones(hole, poly, 8)) continue;
      if (addWater(hole, { outer: poly }, { greenMargin: 6, teeR: 35, hazardMargin: 2 })) return true;
    }
    return false;
  },
};

/** A pond tucked beside or behind the green: the aggressive line flirts with it. */
const greenPond: HoleFeature = {
  id: 'green-pond',
  group: 'water',
  water: true,
  eligible: (f) => f.hole.par !== 3 && waterAllowed(f),
  weight: (f) => (f.ctx.archetype === 'reachable5' || f.ctx.archetype === 'drivable4' ? 3 : 0.9) * waterW(f) * (0.5 + f.ctx.difficulty),
  apply({ hole, rng }) {
    const fwd = approachHeading(hole);
    for (let k = 0; k < 8; k++) {
      const a = rng.sign() * rng.range(45, 140);
      const heading = fwd + a * DEG;
      const r = rng.range(9, 16);
      const edge = greenEdgeDist(hole, heading);
      const center = add(hole.green.center, scale(dirFromHeading(heading), edge + hole.fringeWidth + r + rng.range(3, 6)));
      const poly = blob(rng, center, r, r * rng.range(0.8, 1.4), heading, 0.15, 28);
      if (!clearOfLandingZones(hole, poly, 12)) continue;
      if (addWater(hole, { outer: poly }, { greenMargin: 2.5, teeR: 40 })) return true;
    }
    return false;
  },
};

/** Par 3 with a pond between tee and green: a forced carry. */
const frontPond: HoleFeature = {
  id: 'front-pond',
  tag: 'CARRY',
  group: 'water',
  water: true,
  excludes: ['cross'],
  eligible: (f) => f.hole.par === 3 && waterAllowed(f),
  weight: (f) => 1.5 * waterW(f) * (0.4 + f.ctx.difficulty),
  apply({ hole, rng }) {
    for (let k = 0; k < 6; k++) {
      const sEnd = hole.L - hole.greenR - hole.fringeWidth - rng.range(4, 10);
      const sStart = Math.max(45, hole.L * rng.range(0.3, 0.55));
      if (sEnd - sStart < 20) return false;
      const mid = frameAt(hole.centerline, (sStart + sEnd) / 2);
      const poly = blob(rng, add(mid.p, scale(mid.right, rng.gauss(0, 4))), mid.ob * rng.range(0.7, 1.1), (sEnd - sStart) / 2, mid.heading, 0.12, 30);
      if (!addWater(hole, { outer: poly }, { greenMargin: 2, teeR: 35 })) continue;
      // Only a sliver of approach fairway between the pond and the green.
      hole.fairwayStart = Math.max(hole.fairwayStart, Math.round(sEnd + 2));
      return true;
    }
    return false;
  },
};

/** Island green: water all around the putting surface, with a drop zone short of the lake. */
const islandGreen: HoleFeature = {
  id: 'island',
  tag: 'ISLAND',
  group: 'water',
  water: true,
  excludes: ['greenside', 'cross'],
  eligible: (f) => f.hole.par === 3 && !f.ctx.budget.islandUsed && f.hole.L < 175 && waterAllowed(f),
  weight: (f) => 2.5 * waterW(f),
  apply({ hole, ctx, rng }) {
    const head = approachHeading(hole);
    const lakeStart = hole.L * rng.range(0.35, 0.5);
    const lakeLen = hole.L - lakeStart + hole.greenR + 25;
    const lakeCenter = frameAt(hole.centerline, lakeStart + lakeLen / 2);
    const outer = blob(rng, lakeCenter.p, hole.greenR + rng.range(22, 32), lakeLen / 2, head, 0.1, 36);
    // The island: green + fringe + a narrow collar of rough.
    const island = blob(rng, hole.green.center, hole.greenR + 6, hole.greenR + 7, head, 0.08, 28);
    if (!island.every((p) => pointInPoly(p, outer))) return false;
    if (!hole.green.poly.every((p) => pointInPoly(p, island) && distToPolyEdge(p, island) > hole.fringeWidth)) return false;

    // Find where the centerline enters the lake; drop zone sits just short of it.
    let sEntry = 0;
    for (let s = 0; s < hole.L; s += 2) {
      if (pointInPoly(frameAt(hole.centerline, s).p, outer)) { sEntry = s; break; }
    }
    if (sEntry < 50) return false;
    if (!addWater(hole, { outer, holes: [island] }, { greenMargin: -1, teeR: 35 })) return false;
    hole.dropZone = roundVec(frameAt(hole.centerline, sEntry - 12).p);
    hole.fairwayStart = Math.round(sEntry - rng.range(30, 45));
    hole.fairwayEnd = Math.round(sEntry - 3);
    ctx.budget.islandUsed = true;
    return true;
  },
};

export const FEATURES: HoleFeature[] = [
  islandGreen,
  frontPond,
  lateralWater,
  creek,
  greenPond,
  burn,
  cornerFeature('water'),
  cornerFeature('bunker'),
  crossBunkers,
  wasteCross,
  wasteFlank,
  centerBunker,
  potBunkers,
  fairwayBunker,
  greenside,
];

// ---------------------------------------------------------------------------

export function applyFeatures(hole: HoleDraft, ctx: HoleContext, rng: Rng) {
  const f: FeatureCtx = { hole, ctx, rng };
  const budget = Math.max(1, Math.min(5, Math.round(1.2 + ctx.difficulty * 3.2 + rng.range(-0.6, 0.9))));
  const blockedGroups = new Set<string>();
  let usedWater = false;
  let pool = FEATURES.slice();

  for (let placed = 0; placed < budget && pool.length; ) {
    const eligible = pool.filter((x) => !blockedGroups.has(x.group) && !(x.water && usedWater) && x.eligible(f));
    if (!eligible.length) break;
    // Features already used elsewhere on the course are less likely, keeping the round varied.
    const pick = rng.weighted(eligible.map((x) => [x, x.weight(f) / (1 + 0.7 * (ctx.budget.used[x.id] ?? 0))] as const));
    pool = pool.filter((x) => x !== pick);
    // A feature can't land if something from a group it excludes is already on the hole.
    if (pick.excludes?.some((g) => hole.features.some((id) => FEATURES.find((x) => x.id === id)?.group === g))) continue;
    if (!pick.apply(f)) continue;
    placed++;
    hole.features.push(pick.id);
    if (pick.tag && !hole.tags.includes(pick.tag)) hole.tags.push(pick.tag);
    blockedGroups.add(pick.group);
    pick.excludes?.forEach((g) => blockedGroups.add(g));
    if (pick.water) usedWater = true;
  }
  if (usedWater) ctx.budget.waterHoles++;
  for (const id of hole.features) ctx.budget.used[id] = (ctx.budget.used[id] ?? 0) + 1;
}
