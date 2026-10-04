import { describe, expect, it } from 'vitest';
import { generateCourse } from './course.ts';
import type { Bump } from './types.ts';

const holes = ['2026-02-03', '2026-05-17', '2026-08-08', '2026-11-21'].flatMap((d) => generateCourse(d).holes);
const all = holes.flatMap((h) => h.contours);

const isTrend = (b: Bump) => b.r >= 25;
const isRidge = (b: Bump) => b.r <= 5 && (b.sx ?? 1) >= 4;
const isMound = (b: Bump) => !isTrend(b) && !isRidge(b) && (b.sx ?? 1) <= 3 && b.r < 16;
/** steepest slope of a gaussian bump (rise per yard), across its narrow axis */
const steepest = (b: Bump) => (Math.abs(b.h) * Math.SQRT2 * Math.exp(-0.5)) / b.r;

describe('fairway contours', () => {
  it('most holes carry at least one broad trend', () => {
    const withTrend = holes.filter((h) => h.contours.some(isTrend)).length;
    expect(withTrend / holes.length).toBeGreaterThan(0.7);
  });

  it('broad trends are gentle, long slopes rather than bumps', () => {
    for (const b of all.filter(isTrend)) expect(steepest(b)).toBeLessThan(0.08);
  });

  it('some holes have ridges running across the fairway', () => {
    expect(all.filter(isRidge).length).toBeGreaterThan(5);
  });

  it('isolated mounds and swales are the minority', () => {
    expect(all.filter(isMound).length).toBeLessThan(all.length / 2);
  });
});
