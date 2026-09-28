import { describe, expect, it } from 'vitest';
import { generateCourse, parMix } from './course.ts';
import { isBlocked } from './names.ts';
import { Rng } from './rng.ts';
import { surfaceAt } from './surface.ts';

describe('generateCourse', () => {
  it('is deterministic for a date', () => {
    expect(JSON.stringify(generateCourse('2026-10-02'))).toBe(JSON.stringify(generateCourse('2026-10-02')));
  });

  it('differs between dates', () => {
    const a = generateCourse('2026-10-02');
    const b = generateCourse('2026-10-03');
    expect(a.name === b.name && a.holes[0].yards === b.holes[0].yards).toBe(false);
  });

  it('rejects malformed dates', () => {
    expect(() => generateCourse('2026-13-40')).toThrow();
  });

  it.each(['2026-01-01', '2026-03-15', '2026-07-04', '2026-12-25'])('%s: 9 holes, par 34 to 36, clean name, tee and pin on the right ground', (d) => {
    const c = generateCourse(d);
    expect(c.holes).toHaveLength(9);
    expect(c.par).toBeGreaterThanOrEqual(34);
    expect(c.par).toBeLessThanOrEqual(36);
    expect(isBlocked(c.name)).toBe(false);
    for (const h of c.holes) {
      expect(surfaceAt(h, h.tee)).toBe('tee');
      expect(surfaceAt(h, h.pin)).toBe('green');
    }
  });
});

describe('parMix', () => {
  it('never puts par 3s or par 5s back to back, or a par 3 on hole 9', () => {
    for (let i = 0; i < 200; i++) {
      const p = parMix(new Rng(`p${i}`));
      expect(p[8]).not.toBe(3);
      for (let j = 1; j < 9; j++) expect(p[j] === p[j - 1] && p[j] !== 4).toBe(false);
    }
  });
});
