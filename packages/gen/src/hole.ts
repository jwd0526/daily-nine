// Hole generation pipeline. A hole is designed around where good shots land
// (the skeleton), not around a random curve, so it is playable by construction.
//
//   skeleton → centerline → width profile → green → features (hazards) → trees → scenery

import type { Biome, Centerline, CourseStyle, Hole, Vec, Wind } from './types.ts';
import type { Rng, RngFactory } from './rng.ts';
import {
  add, bounds, catmullRomResample, clamp, dirFromHeading, distToPolyEdge,
  headingOf, lerp, pointInPoly, round1, roundPoly, roundVec, scale, sub,
} from './geom.ts';
import { arcLengths, fairwayPoint, frameAt, totalLength } from './centerline.ts';

export type Archetype =
  | 'short3' | 'mid3' | 'long3'
  | 'straight4' | 'dogleg4' | 'snake4' | 'drivable4' | 'long4'
  | 'three5' | 'reachable5' | 'double5';

/** Hole shapes per par, with selection weights (by difficulty) and optional UI tags. */
export const ARCHETYPES: Record<3 | 4 | 5, { id: Archetype; weight: (diff: number) => number; tag?: string }[]> = {
  3: [
    { id: 'short3', weight: (d) => 1.2 - 0.6 * d },
    { id: 'mid3', weight: () => 1.6 },
    { id: 'long3', weight: (d) => 0.5 + d },
  ],
  4: [
    { id: 'straight4', weight: () => 1.1 },
    { id: 'dogleg4', weight: () => 2.4 },
    { id: 'snake4', weight: () => 0.9 },
    { id: 'drivable4', weight: (d) => 0.9 - 0.4 * d, tag: 'DRIVABLE' },
    { id: 'long4', weight: (d) => 0.4 + 0.9 * d },
  ],
  5: [
    { id: 'three5', weight: () => 1.6 },
    { id: 'reachable5', weight: (d) => 1.2 - 0.5 * d, tag: 'REACHABLE' },
    { id: 'double5', weight: () => 1.1 },
  ],
};

export interface HoleContext {
  number: number;
  par: 3 | 4 | 5;
  difficulty: number;
  biome: Biome;
  wind: Wind;
  style: CourseStyle;
  archetype: Archetype;
  /** Preferred turning direction for this hole's main bend (+1 right, -1 left). */
  bendSign: 1 | -1;
}

/** A hole under construction: the public Hole plus design metadata used by later stages. */
export interface HoleDraft extends Hole {
  /** Arc lengths of the landing zones. */
  lzS: number[];
  /** Bends along the hole: positive angle turns right. */
  bends: { s: number; angle: number }[];
  archetypeId: Archetype;
  /** Arc length from tee to green center. */
  L: number;
  /** Nominal green radius. */
  greenR: number;
}

const DEG = Math.PI / 180;

const BIOME_WIDTH: Record<Biome, number> = { links: 3, parkland: 0, heath: 1, desert: -1, alpine: -1 };

// ---------------------------------------------------------------------------
// 3a. Skeleton: legs between control points; some leg ends are landing zones.

interface Leg {
  len: number;
  /** Turn (radians) applied at the start of this leg; positive turns right. */
  turn: number;
  /** The end of this leg is a landing zone (the last leg always ends at the green). */
  lz?: boolean;
}

interface Skeleton {
  pts: Vec[];
  /** Indices into pts that are landing zones. */
  lzIdx: number[];
  /** Turn angle at each interior control point (index i+1 in pts). */
  turns: number[];
}

/** Lay out the legs for an archetype. Landing zones are sized for the bag (driver ~290 carry). */
function archetypeLegs(ctx: HoleContext, rng: Rng): Leg[] {
  const d = ctx.difficulty;
  const sign = ctx.bendSign;
  const stretch = 1 + 0.06 * ctx.style.length; // approach legs grow on long-course days
  const approach = (lo: number, hi: number) => clamp(lerp(lo, hi, d) + rng.range(-15, 15), lo, hi) * stretch;
  const R = (lo: number, hi: number) => rng.range(lo, hi) * DEG;
  switch (ctx.archetype) {
    case 'short3': return [{ len: rng.range(112, 145), turn: 0 }];
    case 'mid3': return [{ len: rng.range(145, 182) * stretch, turn: 0 }];
    case 'long3': return [{ len: rng.range(182, 220) * stretch, turn: 0 }];
    case 'straight4':
      return [{ len: rng.range(250, 275), turn: 0, lz: true }, { len: approach(95, 175), turn: R(-5, 5) }];
    case 'dogleg4':
      return [{ len: rng.range(245, 272), turn: 0, lz: true }, { len: approach(95, 180), turn: sign * R(15, 40) }];
    case 'snake4':
      return [
        { len: rng.range(120, 150), turn: 0 },
        { len: rng.range(110, 130), turn: sign * R(10, 20), lz: true },
        { len: approach(100, 170), turn: -sign * R(16, 32) },
      ];
    case 'drivable4':
      // A layup zone short of the corner; a big drive can cut it and reach the green.
      return [{ len: rng.range(200, 225), turn: 0, lz: true }, { len: rng.range(80, 105), turn: sign * R(14, 30) }];
    case 'long4':
      return [{ len: rng.range(265, 285), turn: 0, lz: true }, { len: approach(165, 205), turn: sign * R(0, 20) }];
    case 'three5':
      return [
        { len: rng.range(250, 275), turn: 0, lz: true },
        { len: rng.range(160, 215) * stretch, turn: sign * R(5, 28), lz: true },
        { len: approach(90, 135), turn: (rng.chance(0.5) ? sign : -sign) * R(5, 25) },
      ];
    case 'reachable5':
      // One good drive leaves a long second that can find the green.
      return [{ len: rng.range(255, 280), turn: 0, lz: true }, { len: rng.range(205, 238), turn: sign * R(5, 25) }];
    case 'double5':
      return [
        { len: rng.range(245, 270), turn: 0, lz: true },
        { len: rng.range(170, 210) * stretch, turn: sign * R(20, 35), lz: true },
        { len: approach(100, 140), turn: -sign * R(20, 35) },
      ];
  }
}

function buildSkeleton(ctx: HoleContext, rng: Rng): Skeleton {
  const legs = archetypeLegs(ctx, rng);
  // Lay out the legs; if the hole gets too wide for a portrait view, relax the turns.
  for (let relax = 1; ; relax *= 0.8) {
    let heading = rng.gauss(0, 4) * DEG;
    let p: Vec = { x: 0, y: 0 };
    const pts = [p];
    const lzIdx: number[] = [];
    legs.forEach((leg) => {
      heading += leg.turn * relax;
      p = add(p, scale(dirFromHeading(heading), leg.len));
      pts.push(p);
      if (leg.lz) lzIdx.push(pts.length - 1);
    });
    // Rotate so the green sits roughly straight up from the tee.
    const rot = -headingOf(pts[pts.length - 1]) + rng.gauss(0, 3) * DEG;
    const c = Math.cos(rot), s = Math.sin(rot);
    const rotated = pts.map((q) => ({ x: q.x * c + q.y * s, y: -q.x * s + q.y * c }));
    const b = bounds(rotated);
    if (b.maxX - b.minX <= 0.45 * (b.maxY - b.minY) + 40 || relax < 0.3) {
      return { pts: rotated, lzIdx, turns: legs.slice(1).map((l) => l.turn * relax) };
    }
  }
}

// ---------------------------------------------------------------------------
// 3b/3c. Centerline + width profile + fairway meander

function nearestS(pts: Vec[], s: number[], q: Vec): number {
  let bi = 0, bd = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; bi = i; }
  });
  return s[bi];
}

function buildCenterline(sk: Skeleton, ctx: HoleContext, rng: Rng) {
  const { par, difficulty: diff, biome, style } = ctx;
  const pts = catmullRomResample(sk.pts, 5);
  const s = arcLengths(pts);
  const L = s[s.length - 1];

  const lzS = sk.lzIdx.map((i) => nearestS(pts, s, sk.pts[i]));
  const bendS = sk.pts.slice(1, -1).map((q) => nearestS(pts, s, q));

  const hw = (lerp(21, 14, diff) + BIOME_WIDTH[biome] + rng.range(-1.5, 1.5)) * style.width;
  const nW = rng.noise1d(55);
  // Two scales of variation per side so the rough line has both sweeps and wobbles.
  const nObL = rng.noise1d(80), nObR = rng.noise1d(80), nObFine = rng.noise1d(22);
  const nFo = rng.noise1d(rng.range(70, 120));
  // How far the fairway wanders off the corridor centerline (as a fraction of its width).
  const meander = par === 3 ? 0 : rng.chance(0.75) ? rng.range(0.2, 0.6) : 0;
  // Par 3s get a snugger corridor so they don't read as a shapeless blob.
  const obPad = par === 3 ? lerp(16, 11, diff) : lerp(30, 21, diff);
  const w: number[] = [];
  const ob: number[] = [];
  const fo: number[] = [];
  for (const si of s) {
    let lz = 0;
    for (const z of lzS) lz += Math.exp(-(((si - z) / 45) ** 2));
    // Par 3s have no landing zone; keep the approach area a sensible width.
    const shape = par === 3 ? 0.9 : 0.78 + 0.32 * Math.min(1, lz);
    const nearGreen = clamp((L - si) / 50, 0, 1);
    let wi = hw * shape * (1 + 0.18 * nW(si)) * lerp(0.72, 1, nearGreen);
    wi = Math.max(8, wi);
    // The corridor is symmetric about the centerline (surfaceAt uses distance), so blend both
    // sides' noise; the sweeps still read as an irregular, natural rough line.
    const wander = 9 * (nObL(si) + nObR(si + 300)) / 2 + 3 * nObFine(si);
    // Par 3 corridors follow a narrower base so the hole isn't a wide capsule.
    const base = par === 3 ? wi * 0.65 : wi;
    const obi = Math.max(wi + 8, base + obPad + wander, si < 25 ? (par === 3 ? 20 : 28) : 0);
    // Meander fades out near the tee and the green so both stay centered.
    const taper = clamp(Math.min(si - 40, L - 50 - si) / 60, 0, 1);
    let foi = meander * wi * nFo(si) * 1.6 * taper;
    foi = clamp(foi, -(obi - wi - 10), obi - wi - 10);
    w.push(round1(wi));
    ob.push(round1(obi));
    fo.push(round1(foi));
  }
  return { c: { pts: pts.map(roundVec), s: s.map(round1), w, ob, fo } as Centerline, lzS, bendS };
}

// ---------------------------------------------------------------------------
// 3d. Green

type GreenShape = 'oval' | 'kidney' | 'boomerang' | 'long' | 'wide';

/** Green outline as a radial function with a few character-defining harmonics. */
function greenPoly(rng: Rng, shape: GreenShape, center: Vec, r: number, heading: number) {
  let rx = r * rng.range(0.85, 1.1);
  let ry = r * rng.range(1.0, 1.3);
  const phase = rng.range(0, Math.PI * 2);
  const flip = rng.sign();
  let radial = (_a: number) => 1;
  if (shape === 'kidney') {
    // A bean: elongated with one side pinched in.
    radial = (a) => 1 + 0.16 * Math.cos(2 * a) - 0.14 * flip * Math.cos(a) * Math.abs(Math.cos(a));
  } else if (shape === 'boomerang') {
    radial = (a) => 1 + 0.17 * Math.cos(3 * a + phase);
  } else if (shape === 'long') {
    rx *= 0.72; ry *= 1.45;
  } else if (shape === 'wide') {
    rx *= 1.35; ry *= 0.78;
  }
  const wobble = [2, 3, 4, 5].map((k) => ({ k, amp: rng.range(0, 0.06) / k, ph: rng.range(0, Math.PI * 2) }));
  const fwd = dirFromHeading(heading);
  const side = { x: fwd.y, y: -fwd.x };
  const poly: Vec[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    let k = radial(a);
    for (const w of wobble) k += w.amp * Math.sin(w.k * a + w.ph);
    const lx = Math.cos(a) * rx * k, ly = Math.sin(a) * ry * k;
    poly.push(add(center, add(scale(side, lx), scale(fwd, ly))));
  }
  return { poly, rx, ry };
}

function buildGreen(draft: HoleDraft, rng: Rng) {
  const c = draft.centerline;
  const L = totalLength(c);
  const approach = frameAt(c, L - 10);
  const diff = draft.difficulty;
  let r = draft.par === 3 ? lerp(15, 11, diff) + (L < 150 ? -1 : 1) : lerp(17, 12, diff);
  r += rng.range(-1, 1.5);
  const end = c.pts[c.pts.length - 1];
  const center = add(end, scale(approach.right, rng.gauss(0, 2)));
  const shape = rng.weighted<GreenShape>([['oval', 3], ['kidney', 2], ['boomerang', 1.2], ['long', 1], ['wide', 0.8]]);
  const { poly: raw, rx, ry } = greenPoly(rng, shape, center, r, approach.heading + rng.gauss(0, 0.3));
  const poly = roundPoly(raw);

  draft.green = { poly, center: roundVec(center), slope: { gx: 0, gy: 0, bumps: [] } };
  draft.greenR = r;

  // Pin: at least 4 yards inside the edge.
  for (let i = 0; i < 200; i++) {
    const p = add(center, { x: rng.range(-rx, rx), y: rng.range(-ry, ry) });
    const margin = i < 150 ? 4 : 2.5;
    if (pointInPoly(p, poly) && distToPolyEdge(p, poly) >= margin) {
      draft.pin = roundVec(p);
      return;
    }
  }
  draft.pin = roundVec(center);
}

// ---------------------------------------------------------------------------

export function buildHole(ctx: HoleContext, rngs: RngFactory, attempt: number): HoleDraft {
  const key = `hole:${ctx.number}:${attempt}`;
  const layout = rngs(`${key}:layout`);
  const sk = buildSkeleton(ctx, layout);
  const { c, lzS, bendS } = buildCenterline(sk, ctx, layout);
  const L = totalLength(c);
  // Design waypoints: tee, landing zones (on the fairway's own center), green.
  const waypoints = [sk.pts[0], ...lzS.map((z) => fairwayPoint(c, z)), sk.pts[sk.pts.length - 1]];
  const archetype = ARCHETYPES[ctx.par].find((a) => a.id === ctx.archetype);

  const draft: HoleDraft = {
    number: ctx.number,
    par: ctx.par,
    yards: Math.round(L),
    difficulty: Math.round(ctx.difficulty * 100) / 100,
    features: [],
    tags: archetype?.tag ? [archetype.tag] : [],
    archetype: ctx.archetype,
    tee: { x: 0, y: 0 },
    teeHeading: Math.round(headingOf(sub(sk.pts[1], sk.pts[0])) * 1000) / 1000,
    pin: { x: 0, y: 0 },
    skeleton: waypoints.map(roundVec),
    centerline: c,
    fairwayStart: 0,
    fairwayEnd: 0,
    green: { poly: [], center: { x: 0, y: 0 }, slope: { gx: 0, gy: 0, bumps: [] } },
    fringeWidth: 2.5,
    bunkers: [],
    water: [],
    trees: [],
    scenery: [],
    wind: ctx.wind,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    attempts: attempt + 1,
    lzS,
    bends: bendS.map((s, i) => ({ s, angle: sk.turns[i] ?? 0 })),
    archetypeId: ctx.archetype,
    L,
    greenR: 0,
  };

  buildGreen(draft, layout);

  // Fairway extent: optional forced carry off the tee; runs into the front of the green.
  if (ctx.par === 3) {
    draft.fairwayStart = layout.chance(0.65) ? round1(L - layout.range(30, 60)) : round1(L + 50);
  } else {
    const carry = layout.chance(0.2 + 0.35 * ctx.difficulty);
    draft.fairwayStart = round1(carry ? layout.range(110, Math.min(165, lzS[0] - 70)) : layout.range(25, 45));
  }
  draft.fairwayEnd = round1(L - draft.greenR * 0.5);

  // Occasionally a stretch of rough splits the fairway: a carry on the way to the green.
  if (ctx.par > 3 && layout.chance(0.12 + 0.25 * ctx.difficulty)) {
    // Window between the first landing zone and the next one (or the green), clear of both.
    const lo = lzS[0] + 35;
    const hi = lzS.length > 1 ? lzS[1] - 35 : L - draft.greenR - 35;
    const len = layout.range(22, 40);
    if (hi - lo > len + 5) {
      const g0 = round1(layout.range(lo, hi - len));
      draft.fairwayGaps = [[g0, round1(g0 + len)]];
    }
  }


  const edge: Vec[] = [];
  for (let s = -30; s <= L + 40; s += 10) {
    const f = frameAt(c, s);
    edge.push(add(f.p, scale(f.right, f.ob + 12)), add(f.p, scale(f.right, -f.ob - 12)));
  }
  const b = bounds([...edge, ...draft.green.poly]);
  draft.bounds = { minX: round1(b.minX), minY: round1(b.minY), maxX: round1(b.maxX), maxY: round1(b.maxY) };
  return draft;
}

/** Strip design-only metadata for the public JSON. */
export function finalizeHole(d: HoleDraft): Hole {
  const { lzS: _a, bends: _b, L: _c, greenR: _d, archetypeId: _e, ...hole } = d;
  return hole;
}
