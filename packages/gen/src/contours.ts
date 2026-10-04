// fairway and rough contours: mounds, swales and cambers that move a rolling ball.

import type { Bump, Vec } from './types.ts';
import type { Rng } from './rng.ts';
import type { HoleDraft } from './hole.ts';
import { dist, distToPolyEdge, pointInPoly, polyCentroid, round1 } from './geom.ts';
import { fairwayPoint, frameAt } from './centerline.ts';
import { nearestOnCenterline } from './surface.ts';

export function placeContours(h: HoleDraft, rng: Rng) {
  const c = h.centerline;
  const out: Bump[] = [];
  // keep the tee flat and let the green's own slope do the work up there
  const clear = (p: Vec, r: number) =>
    dist(p, h.tee) > 40 && !pointInPoly(p, h.green.poly) && distToPolyEdge(p, h.green.poly) > r * 0.6 + 4;
  const push = (b: Bump) =>
    out.push({ x: round1(b.x), y: round1(b.y), r: round1(b.r), h: Math.round(b.h * 100) / 100, ...(b.sx ? { sx: round1(b.sx), rot: Math.round(b.rot! * 100) / 100 } : {}) });

  const par3 = h.par === 3;
  const fairwayRange = [Math.max(60, h.fairwayStart), Math.max(70, h.L - 40)] as const;

  // broad trends: wide, gentle rises whose flanks tilt long stretches of fairway one way
  const trends = par3 ? 1 : rng.int(1, 3);
  for (let k = 0; k < trends; k++) {
    const s = rng.range(fairwayRange[0], fairwayRange[1]);
    const f = frameAt(c, s);
    const r = rng.range(28, 55);
    // centered off to one side so the fairway sits on a flank, not on top
    const p = fairwayPoint(c, s, rng.sign() * rng.range(0.4, 1.4) * f.w);
    if (dist(p, h.tee) < 40 || pointInPoly(p, h.green.poly)) continue;
    push({ x: p.x, y: p.y, r, h: rng.range(0.8, 2.2) * (rng.chance(0.6) ? 1 : -1), sx: rng.range(1.5, 3), rot: f.heading + rng.gauss(0, 0.25) });
  }

  // ridges: a narrow spine running across the fairway, near where drives and approaches land
  const spots = [...h.lzS, h.L - rng.range(30, 60)];
  const ridges = rng.chance(0.25 + 0.5 * h.difficulty) ? (rng.chance(0.3) ? 2 : 1) : 0;
  for (let k = 0, tries = 0; k < ridges && tries < 8; tries++) {
    const s = rng.pick(spots) + rng.range(-40, 25);
    const f = frameAt(c, s);
    const p = fairwayPoint(c, s, rng.range(-0.3, 0.3) * f.w);
    const r = rng.range(3, 5);
    if (!clear(p, r * 6)) continue;
    push({ x: p.x, y: p.y, r, h: rng.range(0.4, 0.9), sx: rng.range(4, 8), rot: f.heading + Math.PI / 2 + rng.gauss(0, 0.3) });
    k++;
  }

  // a few isolated mounds and swales
  const n = par3 ? rng.int(0, 1) : rng.int(0, 2);
  for (let k = 0, placed = 0; k < n * 4 && placed < n; k++) {
    const s = rng.pick(spots) + rng.range(-35, 35);
    const f = frameAt(c, s);
    const p = fairwayPoint(c, s, rng.range(-0.8, 0.8) * f.w);
    const r = rng.range(6, 15);
    if (!clear(p, r)) continue;
    push({ x: p.x, y: p.y, r, h: rng.range(0.6, 1.8) * (rng.chance(0.65) ? 1 : -1) });
    placed++;
  }

  // cambers: a landing zone with a hazard beside it tilts toward the hazard
  const hazards = [...h.bunkers, ...h.water.map((w) => w.outer)].map(polyCentroid);
  for (const s of h.lzS) {
    if (!rng.chance(0.4 + 0.4 * h.difficulty)) continue;
    const f = frameAt(c, s);
    const beside = hazards
      .map((p) => nearestOnCenterline(c, p))
      .filter((hit) => Math.abs(hit.s - s) < 50 && Math.abs(hit.lat - hit.fo) < f.w + 30)
      .sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s))[0];
    if (!beside) continue;
    const side = Math.sign(beside.lat - beside.fo) || 1;
    const r = rng.range(16, 24);
    // a long rise on the far side of the fairway, so the ground falls toward the hazard
    const p = fairwayPoint(c, s, -side * (f.w + r * 0.3));
    if (!clear(p, r)) continue;
    push({ x: p.x, y: p.y, r, h: rng.range(1.4, 2.4), sx: rng.range(2, 3), rot: f.heading });
  }

  h.contours = out;
}
