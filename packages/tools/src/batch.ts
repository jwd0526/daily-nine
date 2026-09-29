// Batch-generate many dates and report generator health.
// Usage: npm run batch -- [count=365] [startDate=2026-01-01]

import { generateCourse, validateHole, Rng, botPlayHole, AVERAGE, isBlocked } from '@golf/gen';

const count = Number(process.argv[2] ?? 365);
const start = new Date(`${process.argv[3] ?? '2026-01-01'}T00:00:00Z`);

const tally = <K extends string | number>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

const attempts = new Map<number, number>();
const biomes = new Map<string, number>();
const parTotals = new Map<number, number>();
const features = new Map<string, number>();
const featureCounts = new Map<number, number>();
const scoreByPar = new Map<number, number[]>();
const yardsByPar = new Map<number, number[]>();
const names = new Set<string>();
const rejects = new Map<string, number>();
const archetypes = new Map<string, number>();
const themes = new Map<string, number>();
let holes = 0, fallbacks = 0, blocked = 0, ms = 0;

for (let i = 0; i < count; i++) {
  const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
  const t = performance.now();
  const c = generateCourse(d, undefined, {
    onReject: (_n, reasons) => reasons.forEach((r) => tally(rejects, r.replace(/\(.*\)/, '').trim())),
  });
  tally(themes, c.style.theme);
  ms += performance.now() - t;
  tally(biomes, c.biome);
  tally(parTotals, c.par);
  names.add(c.name);
  if (isBlocked(c.name)) blocked++;
  for (const h of c.holes) {
    holes++;
    tally(attempts, h.attempts);
    tally(archetypes, h.archetype ?? '?');
    if (h.attempts === 0) fallbacks++;
    tally(featureCounts, h.features.length);
    h.features.forEach((f) => tally(features, f));
    const rng = new Rng(`batch|${d}|${h.number}`);
    let s = 0;
    for (let k = 0; k < 8; k++) s += botPlayHole(h, rng, AVERAGE).strokes - h.par;
    (scoreByPar.get(h.par) ?? scoreByPar.set(h.par, []).get(h.par)!).push(s / 8);
    (yardsByPar.get(h.par) ?? yardsByPar.set(h.par, []).get(h.par)!).push(h.yards);
  }
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
const sorted = <K,>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `mean ${mean.toFixed(2)}  min ${s[0].toFixed(0)}  p50 ${s[s.length >> 1].toFixed(1)}  max ${s[s.length - 1].toFixed(0)}`;
};

console.log(`${count} courses, ${holes} holes, ${(ms / count).toFixed(0)} ms/course`);
console.log(`first-try pass: ${pct(attempts.get(1) ?? 0, holes)}   fallbacks: ${pct(fallbacks, holes)}`);
console.log('attempts:', [...attempts.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('biomes:', sorted(biomes).map(([k, v]) => `${k} ${pct(v, count)}`).join(', '));
console.log('par totals:', sorted(parTotals).map(([k, v]) => `${k} ${pct(v, count)}`).join(', '));
console.log('features/hole:', [...featureCounts.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${pct(v, holes)}`).join(' '));
console.log('features:', sorted(features).map(([k, v]) => `${k} ${pct(v, holes)}`).join(', '));
for (const p of [3, 4, 5]) {
  console.log(`par ${p}: yards ${stats(yardsByPar.get(p) ?? [0])}`);
  console.log(`        bot avg over par ${stats(scoreByPar.get(p) ?? [0])}`);
}
console.log('themes:', sorted(themes).map(([k, v]) => `${k} ${pct(v, count)}`).join(', '));
console.log('archetypes:', sorted(archetypes).map(([k, v]) => `${k} ${pct(v, holes)}`).join(', '));
console.log('rejection reasons:', sorted(rejects).slice(0, 12).map(([k, v]) => `${k} ×${v}`).join(' | '));
console.log(`unique names: ${names.size}/${count}, blocked: ${blocked}`);
console.log('sample names:', [...names].slice(0, 12).join(' · '));

// Explain why holes fail on early attempts, for tuning.
if (process.argv.includes('--why')) {
  const reasons = new Map<string, number>();
  for (let i = 0; i < Math.min(count, 60); i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    for (const h of generateCourse(d).holes) {
      const v = validateHole(h, new Rng('why'));
      v.reasons.forEach((r) => tally(reasons, r.replace(/\(.*\)/, '')));
    }
  }
  console.log('post-acceptance re-validation failures:', sorted(reasons));
}
