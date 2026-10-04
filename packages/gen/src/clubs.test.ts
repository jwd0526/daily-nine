import { describe, expect, it } from 'vitest';
import { aimConeHalf, CLUBS } from './clubs.ts';

const deg = (rad: number) => (rad * 180) / Math.PI;

describe('aimConeHalf', () => {
  it.each(CLUBS.map((c) => [c.id, c] as const))('%s: normal sweep from 80+ yds, 1.8x inside 15', (_, c) => {
    expect(deg(aimConeHalf(c, 200))).toBeCloseTo(c.cone);
    expect(deg(aimConeHalf(c, 80))).toBeCloseTo(c.cone);
    expect(deg(aimConeHalf(c, 10))).toBeCloseTo(c.cone * 1.8);
  });

  it('widens steadily as the ball gets closer', () => {
    const c = CLUBS[0];
    expect(aimConeHalf(c, 30)).toBeGreaterThan(aimConeHalf(c, 50));
    expect(aimConeHalf(c, 50)).toBeGreaterThan(aimConeHalf(c, 70));
  });
});
