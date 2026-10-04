import { describe, expect, it } from 'vitest';
import { aimConeHalf, CLUBS, lieRange } from './clubs.ts';
import type { Surface } from './types.ts';

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

const club = (id: string) => CLUBS.find((c) => c.id === id)!;
const LIES: Surface[] = ['tee', 'fairway', 'fringe', 'green', 'rough', 'bunker', 'waste', 'trees'];

describe('lieRange', () => {
  it.each(['tee', 'fairway', 'fringe', 'green'] as const)('%s is a clean lie: full power for every club', (lie) => {
    for (const c of CLUBS) expect(lieRange(lie, c)).toEqual([1, 1]);
  });

  it('every range is a valid power fraction with lo <= hi', () => {
    for (const lie of LIES) {
      for (const c of CLUBS) {
        const [lo, hi] = lieRange(lie, c);
        expect(lo, `${lie} ${c.id}`).toBeGreaterThan(0);
        expect(hi, `${lie} ${c.id}`).toBeLessThanOrEqual(1);
        expect(lo, `${lie} ${c.id}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('out of the rough the driver suffers most and wedges least', () => {
    const [, drHi] = lieRange('rough', club('DR'));
    const [w5Lo, w5Hi] = lieRange('rough', club('5W'));
    const [i7Lo, i7Hi] = lieRange('rough', club('7i'));
    const [wLo] = lieRange('rough', club('56°'));
    expect(drHi).toBeLessThanOrEqual(w5Hi);
    expect(w5Hi).toBeLessThan(i7Hi);
    expect(i7Lo).toBeLessThan(wLo);
    expect(w5Lo).toBeLessThan(i7Lo);
  });

  it('sand wedges get out of bunkers far better than woods', () => {
    expect(lieRange('bunker', club('56°'))[0]).toBeGreaterThan(lieRange('bunker', club('5W'))[1]);
  });
});
