// Generate-and-test: a hole is accepted only if the bot finds it playable and fair.

import type { Hole, Poly } from './types.ts';
import type { Rng } from './rng.ts';
import { AVERAGE, PERFECT, botPlayHole } from './bot.ts';
import { dist, isSimplePolygon, pointInPoly, pointInRegion, polysOverlap } from './geom.ts';
import { fairwayPoint, fairwaySegments, frameAt } from './centerline.ts';
import { surfaceAt } from './surface.ts';

export interface Validation {
  ok: boolean;
  reasons: string[];
  /** Average bot score over noisy runs. */
  mean?: number;
}

export const NOISY_RUNS = 24;

/** Structural checks on the layout itself: shapes, overlaps, and what sits where. */
export function layoutIssues(hole: Hole): string[] {
  const out: string[] = [];
  const hazardPolys: Poly[] = [...hole.bunkers, ...(hole.waste ?? [])];

  // Water: clean shapes, separate bodies, never on the green, well clear of the tee.
  hole.water.forEach((w, i) => {
    if (!isSimplePolygon(w.outer)) out.push('water shape folds over itself');
    for (let j = i + 1; j < hole.water.length; j++) {
      if (polysOverlap(w.outer, hole.water[j].outer, 8)) out.push('bodies of water overlap');
    }
    if (hazardPolys.some((h) => polysOverlap(w.outer, h, 1))) out.push('sand overlaps water');
    if (w.outer.some((p) => dist(p, hole.tee) < 28)) out.push('water too close to tee');
  });
  if (hole.green.poly.some((p) => hole.water.some((w) => pointInRegion(p, w)))) out.push('water on the green');

  // Sand: clean shapes, no stacking, off the green, clear of the tee.
  hazardPolys.forEach((b, i) => {
    if (!isSimplePolygon(b)) out.push('sand shape folds over itself');
    for (let j = i + 1; j < hazardPolys.length; j++) {
      if (polysOverlap(b, hazardPolys[j], 1)) out.push('sand hazards overlap');
    }
    if (b.some((p) => pointInPoly(p, hole.green.poly))) out.push('sand on the green');
    if (b.some((p) => dist(p, hole.tee) < 22)) out.push('sand too close to tee');
  });

  // Landing zones: a ring around each must be playable ground.
  for (const lz of hole.skeleton.slice(1, -1)) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const s = surfaceAt(hole, { x: lz.x + Math.cos(a) * 7, y: lz.y + Math.sin(a) * 7 });
      if (s !== 'fairway' && s !== 'rough') { out.push(`landing zone crowded by ${s}`); break; }
    }
  }

  // Fairway shouldn't be smothered: cap how much of it is hazard.
  let samples = 0, blocked = 0;
  for (const [a, b] of fairwaySegments(hole)) {
    for (let s = a; s <= b; s += 5) {
      const f = frameAt(hole.centerline, s);
      for (let t = -0.9; t <= 0.9; t += 0.3) {
        const sf = surfaceAt(hole, fairwayPoint(hole.centerline, s, t * f.w));
        samples++;
        if (sf === 'water' || sf === 'bunker' || sf === 'waste') blocked++;
      }
    }
  }
  if (samples > 0 && blocked / samples > 0.22) out.push('fairway mostly hazard');

  // Scenery is decoration only: it must stay out of play.
  for (const sc of hole.scenery) {
    if (sc.poly.some((p) => surfaceAt(hole, p) !== 'ob' && surfaceAt(hole, p) !== 'trees')) {
      out.push('scenery inside the playing area');
      break;
    }
  }
  return [...new Set(out)];
}

export function validateHole(hole: Hole, rng: Rng): Validation {
  const reasons: string[] = layoutIssues(hole);

  // Fairness checks.
  if (surfaceAt(hole, hole.tee) !== 'tee') reasons.push('tee not clear');
  if (surfaceAt(hole, hole.pin) !== 'green') reasons.push('pin not on green');
  for (const b of hole.bunkers) if (b.some((p) => pointInPoly(p, hole.green.poly))) reasons.push('bunker overlaps green');
  for (const p of hole.skeleton.slice(1, -1)) {
    const s = surfaceAt(hole, p);
    if (s !== 'fairway') reasons.push(`landing zone is ${s}`);
  }
  if (hole.dropZone && !['fairway', 'rough'].includes(surfaceAt(hole, hole.dropZone))) reasons.push('drop zone unplayable');
  if (reasons.length) return { ok: false, reasons };

  // Reachability: a perfect player reaches the green in regulation with no penalty.
  const clean = botPlayHole(hole, rng, PERFECT);
  if (clean.penalties > 0) reasons.push('perfect play takes a penalty');
  if (clean.toGreen > hole.par - 2) reasons.push(`green not reachable in regulation (${clean.toGreen})`);
  if (reasons.length) return { ok: false, reasons };

  // Difficulty: an average player scores within a sensible band of par.
  let total = 0;
  for (let i = 0; i < NOISY_RUNS; i++) total += botPlayHole(hole, rng, AVERAGE).strokes;
  const mean = total / NOISY_RUNS;
  if (mean < hole.par - 0.5) reasons.push(`too easy (${mean.toFixed(2)})`);
  if (mean > hole.par + 1.3) reasons.push(`too hard (${mean.toFixed(2)})`);

  // Sanity: green must actually be far enough from the tee for its par.
  if (hole.par > 3 && dist(hole.tee, hole.green.center) < 250) reasons.push('too short for par');

  return { ok: reasons.length === 0, reasons, mean };
}
