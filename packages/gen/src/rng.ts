// Deterministic seeded randomness. Every subsystem gets its own named stream
// so that tweaking one stage (e.g. tree scatter) never shifts another (e.g. fairways).

/** cyrb128: hashes a string into four 32-bit seeds. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 PRNG: returns floats in [0, 1). */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;

  constructor(seed: string) {
    const [a, b, c, d] = cyrb128(seed);
    this.next = sfc32(a, b, c, d);
    // Warm up: the first few outputs of sfc32 are weakly mixed.
    for (let i = 0; i < 12; i++) this.next();
  }

  float(): number {
    return this.next();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= Math.max(0, w);
      if (r <= 0) return item;
    }
    return items[items.length - 1][0];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Standard normal via Box-Muller. */
  gauss(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** 1D smooth value noise in roughly [-1, 1], with features every `scale` units. */
  noise1d(scale: number): (t: number) => number {
    const knots: number[] = [];
    const get = (i: number) => {
      while (knots.length <= i) knots.push(this.range(-1, 1));
      return knots[i];
    };
    // Pre-roll knots so the stream consumption is independent of query order.
    for (let i = 0; i < 64; i++) get(i);
    return (t: number) => {
      const x = Math.max(0, t / scale);
      const i = Math.floor(x);
      const f = x - i;
      const s = f * f * (3 - 2 * f);
      return get(i % 63) * (1 - s) + get((i % 63) + 1) * s;
    };
  }
}

/** Factory for named sub-streams derived from a root seed. */
export type RngFactory = (name: string) => Rng;

export function rngFactory(rootSeed: string): RngFactory {
  return (name: string) => new Rng(`${rootSeed}#${name}`);
}
