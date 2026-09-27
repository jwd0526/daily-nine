// Decorative scenery outside the playing corridor (anything out there is OB anyway).

import type { Biome, Scenery, Vec } from './types.ts';
import type { Rng } from './rng.ts';
import type { HoleDraft } from './hole.ts';
import { blob, distToPolyEdge, polysOverlap, roundPoly } from './geom.ts';
import { GREEN_APRON, nearestOnCenterline } from './surface.ts';
import { frameAt, offsetAt } from './centerline.ts';

function shoreline(h: HoleDraft, rng: Rng, side: number, gap: number, depth: number): Vec[] {
  const n = rng.noise1d(60);
  const edge: Vec[] = [], far: Vec[] = [];
  for (let s = -80; s <= h.L + 80; s += 8) {
    const f = frameAt(h.centerline, s);
    edge.push(offsetAt(h.centerline, s, side * (f.ob + gap + n(s + 80) * 7)));
    far.push(offsetAt(h.centerline, s, side * (f.ob + gap + depth)));
  }
  return [...edge, ...far.reverse()];
}

function scatter(h: HoleDraft, rng: Rng, kind: Scenery['kind'], count: number, size: [number, number], out: Scenery[]) {
  for (let i = 0; i < count; i++) {
    const s = rng.range(-40, h.L + 40);
    const f = frameAt(h.centerline, s);
    const side = rng.sign();
    const r = rng.range(size[0], size[1]);
    const c = offsetAt(h.centerline, s, side * (f.ob + r * 0.9 + rng.range(4, 40)));
    out.push({ kind, poly: roundPoly(blob(rng, c, r, r * rng.range(0.7, 1.4), rng.range(0, 6.28), 0.3, 14)) });
  }
}

export function placeScenery(h: HoleDraft, biome: Biome, rng: Rng) {
  const out: Scenery[] = [];
  switch (biome) {
    case 'links': {
      out.push({ kind: 'sea', poly: roundPoly(shoreline(h, rng, drySide(h, rng), rng.range(18, 34), 600)) });
      scatter(h, rng, 'dune', 7, [10, 22], out);
      break;
    }
    case 'alpine':
      scatter(h, rng, 'rock', 9, [10, 28], out);
      if (rng.chance(0.4)) out.push({ kind: 'lake', poly: roundPoly(shoreline(h, rng, drySide(h, rng), rng.range(25, 45), 600)) });
      break;
    case 'desert':
      scatter(h, rng, 'scrub', 10, [12, 30], out);
      scatter(h, rng, 'rock', 4, [8, 18], out);
      break;
    case 'heath':
      scatter(h, rng, 'scrub', 9, [12, 26], out);
      break;
    case 'parkland':
      scatter(h, rng, 'forest', 6, [18, 34], out);
      if (rng.chance(0.3)) scatter(h, rng, 'lake', 1, [25, 45], out);
      break;
  }
  h.scenery = out.filter((sc) => sceneryClear(h, sc));
}

/** The side of the hole (+1 right, -1 left) with no hazard water, so a sea or lake doesn't crowd it. */
function drySide(h: HoleDraft, rng: Rng): 1 | -1 {
  let lean = 0;
  for (const w of h.water) for (const p of w.outer) lean += Math.sign(nearestOnCenterline(h.centerline, p).lat);
  return lean > 0 ? -1 : lean < 0 ? 1 : rng.sign();
}

/** Scenery must stay out of the playing area and never touch or merge with hazard water. */
function sceneryClear(h: HoleDraft, sc: Scenery): boolean {
  const isWater = sc.kind === 'sea' || sc.kind === 'lake';
  for (const p of sc.poly) {
    const hit = nearestOnCenterline(h.centerline, p);
    if (hit.d < hit.ob + 3) return false;
    if (distToPolyEdge(p, h.green.poly) < GREEN_APRON + 3) return false;
  }
  const gap = isWater ? 10 : 2;
  if (!h.water.every((w) => !polysOverlap(sc.poly, w.outer, gap))) return false;
  // Sand that spills past the boundary still counts as a hazard: keep scenery off it too.
  return [...h.bunkers, ...(h.waste ?? [])].every((b) => !polysOverlap(sc.poly, b, 2));
}
