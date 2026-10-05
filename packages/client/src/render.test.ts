import { describe, expect, it } from 'vitest';
import { sameCamera, stepCamera, type Camera } from './render.ts';

const run = (from: Camera, to: Camera, max = 300) => {
  let cam = from;
  for (let i = 0; i < max; i++) {
    if (sameCamera(cam, to)) return { cam, steps: i };
    cam = stepCamera(cam, to);
  }
  return { cam, steps: max };
};

describe('stepCamera', () => {
  it('lands exactly on the target instead of easing forever', () => {
    const to = { cx: 300, cy: -120, k: 6 };
    const { cam, steps } = run({ cx: 0, cy: 0, k: 1 }, to);
    expect(cam).toEqual(to);
    expect(steps).toBeLessThan(300);
  });

  it('lands exactly when only the zoom is off', () => {
    const to = { cx: 50, cy: 80, k: 12 };
    const { cam, steps } = run({ cx: 50, cy: 80, k: 11 }, to);
    expect(cam).toEqual(to);
    expect(steps).toBeLessThan(300);
  });

  it('eases part of the way while the target is far', () => {
    const from = { cx: 0, cy: 0, k: 1 };
    const to = { cx: 100, cy: 100, k: 4 };
    const next = stepCamera(from, to);
    expect(next.cx).toBeGreaterThan(0);
    expect(next.cx).toBeLessThan(100);
    expect(next.k).toBeGreaterThan(1);
    expect(next.k).toBeLessThan(4);
  });

  it('keeps zoom positive and heading toward the target when zooming out', () => {
    let cam: Camera = { cx: 0, cy: 0, k: 40 };
    const to = { cx: 0, cy: 0, k: 0.5 };
    for (let i = 0; i < 20; i++) {
      const next = stepCamera(cam, to);
      expect(next.k).toBeGreaterThan(0.5);
      expect(next.k).toBeLessThan(cam.k);
      cam = next;
    }
  });

  it('snaps a move too small to see, but not one a pixel could show', () => {
    const to = { cx: 10, cy: 10, k: 20 };
    // 0.001 yd at 20 px/yd is 0.02px
    expect(stepCamera({ cx: 10.001, cy: 10, k: 20 }, to)).toEqual(to);
    // 0.01 yd at 20 px/yd is 0.2px
    expect(stepCamera({ cx: 10.01, cy: 10, k: 20 }, to)).not.toEqual(to);
  });

  it('stays put when already on target', () => {
    const to = { cx: 7, cy: -3, k: 2.5 };
    expect(stepCamera({ ...to }, to)).toEqual(to);
  });
});

describe('sameCamera', () => {
  const a = { cx: 1, cy: 2, k: 3 };
  it('matches equal values on different objects', () => expect(sameCamera(a, { ...a })).toBe(true));
  it('differs on any field', () => {
    expect(sameCamera(a, { ...a, cx: 1.0001 })).toBe(false);
    expect(sameCamera(a, { ...a, cy: 2.0001 })).toBe(false);
    expect(sameCamera(a, { ...a, k: 3.0001 })).toBe(false);
  });
});
