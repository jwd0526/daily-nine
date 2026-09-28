import { describe, expect, it } from 'vitest';
import { generateCourse } from './course.ts';
import { polysOverlap } from './geom.ts';
import { layoutIssues } from './validate.ts';

describe('layoutIssues', () => {
  it.each(['2026-02-11', '2026-05-30', '2026-08-19', '2026-10-14'])('%s: every hole passes, no water bodies touch', (d) => {
    for (const h of generateCourse(d).holes) {
      expect(layoutIssues(h), `hole ${h.number}`).toEqual([]);
      for (let i = 0; i < h.water.length; i++) {
        for (let j = i + 1; j < h.water.length; j++) {
          expect(polysOverlap(h.water[i].outer, h.water[j].outer)).toBe(false);
        }
      }
    }
  });
});
