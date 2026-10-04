import { describe, expect, it } from 'vitest';
import { CLUBS } from './clubs.ts';
import { generateCourse } from './course.ts';
import { simulateShot } from './physics.ts';
import { terrainGradient, terrainHeight } from './surface.ts';
import type { Hole } from './types.ts';

const base = generateCourse('2026-10-04').holes.find((h) => h.par === 4)!;
const lz = base.skeleton[1];
const mound = { x: lz.x - 12, y: lz.y + 30, r: 14, h: 1 };

// a controlled hole: wide flat fairway, no hazards or trees, no wind, one known mound
const flat: Hole = {
  ...base,
  wind: { dir: 0, mph: 0 },
  trees: [], bunkers: [], water: [], waste: [], contours: [],
  fairwayStart: 0, fairwayEnd: 10_000, fairwayGaps: [],
  centerline: { ...base.centerline, w: base.centerline.w.map(() => 80), ob: base.centerline.ob.map(() => 120), fo: undefined },
};
const contoured: Hole = { ...flat, contours: [mound] };

describe('terrainHeight', () => {
  it('is flat with no contours', () => {
    expect(terrainHeight(flat, lz)).toBe(0);
  });

  it('peaks at a mound center and fades to nothing far away', () => {
    expect(terrainHeight(contoured, mound)).toBeCloseTo(mound.h, 2);
    expect(terrainHeight(contoured, { x: mound.x + 200, y: mound.y })).toBeCloseTo(0, 3);
  });

  it('slopes away from a mound center (downhill points outward)', () => {
    const g = terrainGradient(contoured, { x: mound.x + 8, y: mound.y });
    expect(g.x).toBeLessThan(0); // rising toward the center (-x)
  });

  it('never moves the green: contours fade out at its edge', () => {
    const onGreen: Hole = { ...contoured, contours: [{ ...base.green.center, r: 14, h: 1 }] };
    expect(terrainHeight(onGreen, base.green.center)).toBe(0);
  });
});

describe('contours in play', () => {
  it('a ball rolling past a mound drifts downhill compared with flat ground', () => {
    const wedge = CLUBS.find((c) => c.id === '60°')!;
    const shot = { from: lz, heading: 0, club: wedge, power: 0.32 };
    const onFlat = simulateShot(flat, shot, () => 0).end;
    const onSlope = simulateShot(contoured, shot, () => 0).end;
    expect(onSlope.x - onFlat.x).toBeGreaterThan(0.3); // pushed +x, away from the mound
  });
});
