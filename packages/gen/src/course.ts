import type { Biome, Course, CourseStyle, Hole, Wind } from './types.ts';
import { rngFactory, type Rng, type RngFactory } from './rng.ts';
import { courseName } from './names.ts';
import { ARCHETYPES, buildHole, finalizeHole, type Archetype, type HoleContext } from './hole.ts';
import { copyBudget, type CourseBudget } from './features.ts';
import { validateHole } from './validate.ts';
import { clamp, distToPolyEdge } from './geom.ts';

/** Bump whenever generation changes in a way that alters output for a given date. */
export const GEN_VERSION = 'v2';
export const MAX_ATTEMPTS = 20;

const BIOMES: [Biome, number][] = [['parkland', 3], ['links', 2.5], ['heath', 2], ['alpine', 1.5], ['desert', 1.2]];
const MAX_WATER: Record<Biome, number> = { links: 3, parkland: 3, heath: 2, alpine: 2, desert: 1 };

/** Nine pars totalling 34–36, no back-to-back par 3s, no adjacent par 5s, hole 9 not a par 3. */
export function parMix(rng: Rng): (3 | 4 | 5)[] {
  const mix = rng.weighted<[number, number]>([
    [[2, 2], 6], // par 36
    [[2, 1], 3], // par 35
    [[3, 2], 1], // par 35
    [[3, 1], 1], // par 34
  ]);
  const [threes, fives] = mix;
  const base: (3 | 4 | 5)[] = [
    ...Array<3>(threes).fill(3), ...Array<5>(fives).fill(5), ...Array<4>(9 - threes - fives).fill(4),
  ];
  for (let i = 0; i < 500; i++) {
    const order = rng.shuffle(base.slice());
    const ok = order.every((p, j) => j === 0 || !(p === order[j - 1] && p !== 4)) && order[8] !== 3;
    if (ok) return order;
  }
  return [4, 3, 5, 4, 4, 3, 4, 5, 4];
}

/** Difficulty arc: gentle opener, rise through the middle, a breather, strong finish. */
function difficultyArc(rng: Rng): number[] {
  const shape = [0.2, 0.35, 0.5, 0.45, 0.65, 0.3, 0.6, 0.75, 0.7];
  const out = shape.map((d) => clamp(d + rng.range(-0.15, 0.15), 0.05, 0.95));
  // Guarantee at least one breather.
  if (Math.min(...out) > 0.3) out[rng.int(0, 8)] = rng.range(0.1, 0.25);
  return out;
}

/** The day's personality: a theme that leans the course one way, plus some jitter. */
function courseStyle(rng: Rng): CourseStyle {
  const theme = rng.weighted<string>([
    ['balanced', 4], ['watery', 1.2], ['sandy', 1.2], ['wooded', 1], ['open', 1], ['tight', 1], ['long', 0.8], ['short', 0.8],
  ]);
  const lean: Record<string, Partial<Omit<CourseStyle, 'theme'>>> = {
    balanced: {},
    watery: { water: 1.7, sand: 0.8 },
    sandy: { sand: 1.6, water: 0.7 },
    wooded: { trees: 1.6, width: 0.92 },
    open: { trees: 0.45, width: 1.15 },
    tight: { width: 0.84, trees: 1.25 },
    long: { length: 1 },
    short: { length: -1 },
  };
  const l = lean[theme];
  const j = () => rng.range(0.85, 1.15);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    theme,
    water: r2((l.water ?? 1) * j()),
    sand: r2((l.sand ?? 1) * j()),
    trees: r2((l.trees ?? 1) * j()),
    width: r2((l.width ?? 1) * rng.range(0.94, 1.06)),
    length: r2(clamp((l.length ?? 0) + rng.range(-0.35, 0.35), -1, 1)),
  };
}

/** Choose a shape for each hole: weighted by difficulty, avoiding repeats, alternating bend directions. */
function planHoles(rng: Rng, pars: (3 | 4 | 5)[], diffs: number[]) {
  const counts = new Map<Archetype, number>();
  let prev: Archetype | undefined;
  const signs: (1 | -1)[] = [];
  return pars.map((par, i) => {
    const options = ARCHETYPES[par].map((a) => {
      let w = Math.max(0.05, a.weight(diffs[i]));
      w *= 0.35 ** (counts.get(a.id) ?? 0);
      if (a.id === prev) w *= 0.1;
      return [a.id, w] as const;
    });
    const archetype = rng.weighted(options);
    counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
    prev = archetype;
    // No three holes in a row bending the same way.
    let bendSign: 1 | -1 = rng.sign();
    if (signs.length >= 2 && signs[signs.length - 1] === signs[signs.length - 2]) bendSign = (-signs[signs.length - 1]) as 1 | -1;
    signs.push(bendSign);
    return { archetype, bendSign };
  });
}

/** Plain shapes to fall back on if a hole's planned shape keeps failing validation. */
const SAFE_ARCHETYPE: Record<3 | 4 | 5, Archetype> = { 3: 'mid3', 4: 'straight4', 5: 'three5' };

/** Daily weather: one base wind, shifting per hole because each hole is routed in a different direction. */
function holeWinds(rng: Rng): Wind[] {
  const baseDir = rng.range(0, Math.PI * 2);
  const baseMph = rng.weighted<[number, number]>([[[0, 6], 2], [[5, 12], 5], [[10, 18], 2]]);
  const mph = rng.range(baseMph[0], baseMph[1]);
  let routing = rng.range(0, Math.PI * 2);
  const winds: Wind[] = [];
  for (let i = 0; i < 9; i++) {
    routing += rng.range(-2.2, 2.2);
    const dir = (((baseDir - routing + rng.gauss(0, 0.2)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    winds.push({ dir: Math.round(dir * 1000) / 1000, mph: Math.round(clamp(mph + rng.range(-4, 4), 0, 22)) });
  }
  return winds;
}

export interface GenerateOptions {
  /** Called with the reasons each time a hole attempt is rejected (for tuning tools). */
  onReject?: (hole: number, reasons: string[]) => void;
}

function generateHole(ctx: HoleContext, rngs: RngFactory, opts: GenerateOptions): Hole {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const budget = copyBudget(ctx.budget);
    // After many failures, fall back to a plainer shape for the rest of the attempts.
    const archetype = attempt < 12 ? ctx.archetype : SAFE_ARCHETYPE[ctx.par];
    const draft = buildHole({ ...ctx, budget, archetype }, rngs, attempt);
    const hole = finalizeHole(draft);
    const v = validateHole(hole, rngs(`hole:${ctx.number}:${attempt}:bot`));
    if (v.ok) {
      Object.assign(ctx.budget, budget);
      return hole;
    }
    opts.onReject?.(ctx.number, v.reasons);
  }
  return fallbackHole(ctx, rngs);
}

/** A guaranteed-fair hole: easy layout, greenside bunkers only. */
function fallbackHole(ctx: HoleContext, rngs: RngFactory): Hole {
  const budget: CourseBudget = { islandUsed: true, waterHoles: 99, maxWaterHoles: 0, used: {} };
  const draft = buildHole({ ...ctx, difficulty: 0.05, budget, archetype: SAFE_ARCHETYPE[ctx.par] }, rngs, 99);
  draft.bunkers = draft.bunkers.filter((b) => b.every((p) => distToPolyEdge(p, draft.green.poly) < 15));
  draft.water = [];
  draft.waste = [];
  draft.fairwayGaps = undefined;
  draft.dropZone = undefined;
  draft.features = draft.features.filter((f) => f === 'greenside-bunkers');
  draft.tags = [];
  draft.attempts = 0;
  return finalizeHole(draft);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function generateCourse(date: string, version = GEN_VERSION, opts: GenerateOptions = {}): Course {
  if (!isValidDate(date)) throw new Error(`Invalid date: ${date}`);
  const rngs = rngFactory(`${version}|${date}`);
  const r = rngs('course');
  const biome = r.weighted(BIOMES);
  const name = courseName(rngs('name'), biome);
  const pars = parMix(r);
  const diffs = difficultyArc(r);
  const winds = holeWinds(rngs('wind'));
  const style = courseStyle(rngs('style'));
  const plan = planHoles(rngs('plan'), pars, diffs);
  const budget: CourseBudget = {
    islandUsed: false,
    waterHoles: 0,
    maxWaterHoles: Math.max(1, Math.round(MAX_WATER[biome] * style.water)),
    used: {},
  };

  const holes = pars.map((par, i) =>
    generateHole({ number: i + 1, par, difficulty: diffs[i], biome, wind: winds[i], budget, style, ...plan[i] }, rngs, opts),
  );
  return {
    version,
    date,
    name,
    biome,
    style,
    par: pars.reduce((a, b) => a + b, 0),
    holes,
  };
}
