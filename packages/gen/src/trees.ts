import type { Biome, CourseStyle, Tree, Vec } from './types.ts';
import type { Rng } from './rng.ts';
import type { HoleDraft } from './hole.ts';
import { dist, distToPolyEdge, pointInPoly, pointInRegion, round1 } from './geom.ts';
import { fairwayPoint, frameAt, offsetAt } from './centerline.ts';
import { nearestOnCenterline } from './surface.ts';

const DENSITY: Record<Biome, number> = { parkland: 1, alpine: 0.9, heath: 0.5, desert: 0.22, links: 0.12 };
const SIZE: Record<Biome, [number, number]> = {
  parkland: [2.8, 4.8], alpine: [2.2, 3.6], heath: [2.2, 3.8], desert: [1.3, 2.2], links: [2, 3.2],
};
const HEIGHT: Record<Biome, [number, number]> = {
  parkland: [14, 22], alpine: [16, 26], heath: [10, 16], desert: [4, 8], links: [8, 12],
};

/**
 * Scatter trees in the rough band beside the fairway, thinning toward the tee and green,
 * using dart-throwing with a min-distance test (a cheap Poisson-disc approximation).
 */
export function placeTrees(h: HoleDraft, biome: Biome, style: CourseStyle, rng: Rng) {
  // Each hole gets its own feel: some tight and tree-lined, some open.
  const density = Math.min(1.25, DENSITY[biome] * style.trees * rng.range(0.6, 1.35));
  const [rMin, rMax] = SIZE[biome];
  const [hMin, hMax] = HEIGHT[biome];
  const trees: Tree[] = [];
  const c = h.centerline;

  const ok = (p: Vec, r: number) => {
    if (dist(p, h.tee) < 16) return false;
    if (pointInPoly(p, h.green.poly) || distToPolyEdge(p, h.green.poly) < 8 + r) return false;
    if (h.bunkers.some((b) => pointInPoly(p, b) || distToPolyEdge(p, b) < r + 1)) return false;
    if ((h.waste ?? []).some((w) => pointInPoly(p, w) || distToPolyEdge(p, w) < r)) return false;
    if (h.water.some((w) => pointInRegion(p, w) || distToPolyEdge(p, w.outer) < r + 1)) return false;
    if (h.dropZone && dist(p, h.dropZone) < 10) return false;
    // Never on the fairway itself.
    const hit = nearestOnCenterline(c, p);
    if (Math.abs(hit.lat - hit.fo) < hit.w + r + 1 && hit.s > h.fairwayStart - 10 && hit.s < h.fairwayEnd + 5) return false;
    return trees.every((t) => dist(p, t) > (t.r + r) * 0.85);
  };

  const add = (p: Vec, r: number, ht: number) => {
    trees.push({ x: round1(p.x), y: round1(p.y), r: round1(r), h: Math.round(ht) });
  };

  // Rough band (measured from the fairway edge) out to just beyond the boundary.
  for (let s = -20; s <= h.L + 30; s += 3) {
    const f = frameAt(c, s);
    for (const side of [-1, 1]) {
      if (!rng.chance(density * 0.9)) continue;
      const clump = rng.chance(0.3) ? rng.int(2, 3) : 1;
      for (let k = 0; k < clump; k++) {
        const r = rng.range(rMin, rMax);
        // Inner edge of the tree line varies so the rough has bays and points.
        let lat = f.fo + side * (f.w + rng.range(7, Math.max(9, f.ob - f.w + 12)));
        lat = Math.max(-f.ob - 12, Math.min(f.ob + 12, lat));
        const p = offsetAt(c, s + rng.range(-2, 2), lat);
        if (ok(p, r)) add(p, r, rng.range(hMin, hMax));
      }
    }
  }

  // Occasionally a lone tree guarding the inside of a dogleg corner.
  for (const b of h.bends) {
    if (Math.abs(b.angle) < 0.25 || !rng.chance(0.3 + density * 0.3)) continue;
    const s = b.s - rng.range(20, 45);
    const r = rMax * 1.2;
    const p = fairwayPoint(c, s, Math.sign(b.angle) * (frameAt(c, s).w + r + rng.range(1, 4)));
    if (ok(p, r)) add(p, r, hMax + 4);
  }

  // Sometimes a grove right off the fairway edge near a landing zone: stray and you're blocked.
  if (h.par > 3 && rng.chance(0.15 + 0.3 * h.difficulty * Math.min(1, density + 0.3))) {
    const z = h.lzS[rng.int(0, h.lzS.length - 1)] + rng.range(-10, 40);
    const side = rng.sign();
    const center = fairwayPoint(c, z, side * (frameAt(c, z).w + rng.range(5, 9)));
    for (let k = 0, n = rng.int(3, 6); k < n; k++) {
      const r = rng.range(rMin, rMax) * 1.1;
      const p = { x: center.x + rng.gauss(0, 4), y: center.y + rng.gauss(0, 6) };
      if (ok(p, r)) add(p, r, rng.range(hMin, hMax) + 3);
    }
  }

  h.trees = trees;
}
