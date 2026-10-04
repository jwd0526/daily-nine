// fairway and rough contours: mounds, swales and cambers that move a rolling ball.

import type { Bump, Vec } from './types.ts';
import type { Rng } from './rng.ts';
import type { HoleDraft } from './hole.ts';
import { clamp, dist, distToPolyEdge, pointInPoly, polyCentroid, round1 } from './geom.ts';
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

  // mounds and swales around where shots land: landing zones and the approach
  const par3 = h.par === 3;
  const spots = [...h.lzS, h.L - rng.range(30, 60)];
  const n = clamp(Math.round(1.5 + h.difficulty * 3 + rng.range(-0.5, 1)), par3 ? 1 : 2, par3 ? 3 : 6);
  for (let k = 0, placed = 0; k < n * 4 && placed < n; k++) {
    const s = rng.pick(spots) + rng.range(-35, 35);
    const f = frameAt(c, s);
    const p = fairwayPoint(c, s, rng.range(-0.8, 0.8) * f.w);
    const r = rng.range(6, 15);
    if (!clear(p, r)) continue;
    const height = rng.range(0.6, 1.8) * (rng.chance(0.65) ? 1 : -1);
    const stretched = rng.chance(0.4);
    push({
      x: p.x, y: p.y, r, h: height,
      ...(stretched ? { sx: rng.range(1.5, 3), rot: f.heading + (rng.chance(0.5) ? 0 : Math.PI / 2) + rng.gauss(0, 0.3) } : {}),
    });
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
