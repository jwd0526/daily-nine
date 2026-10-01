// Write static course files for deployment: one JSON per UTC date, from `days` ago through today.
// Courses are deterministic, so pre-generating is identical to generating on request.
// Usage: npm run courses -- [outDir=packages/client/dist/courses] [days=30]

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateCourse } from '@golf/gen';

const outDir = path.resolve(process.argv[2] ?? 'packages/client/dist/courses');
const days = Number(process.argv[3] ?? 30);

mkdirSync(outDir, { recursive: true });
const today = new Date();
const dates: string[] = [];
for (let i = days; i >= 0; i--) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
  dates.push(d.toISOString().slice(0, 10));
}

const t = performance.now();
for (const date of dates) {
  writeFileSync(path.join(outDir, `${date}.json`), JSON.stringify(generateCourse(date)));
}
console.log(`wrote ${dates.length} courses (${dates[0]} → ${dates[dates.length - 1]}) to ${outDir} in ${Math.round(performance.now() - t)}ms`);
