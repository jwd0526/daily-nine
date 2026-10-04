export interface Club {
  id: string;
  name: string;
  /** Full-power carry in yards from a clean lie, no wind. */
  carry: number;
  /** Apex height of the flight in yards. */
  apex: number;
  /** Initial roll speed after landing, as a fraction of the landing speed proxy. */
  roll: number;
  /** Landing scatter radius (yards) at long range; shrinks closer to the pin. */
  spray: number;
  /** Half-angle (degrees) of the oscillating aim cone. */
  cone: number;
  /** Seconds for one full aim sweep (left → right → left). */
  sweep: number;
}

export const CLUBS: Club[] = [
  { id: 'DR', name: 'Driver', carry: 290, apex: 32, roll: 0.10, spray: 14, cone: 10, sweep: 1.625 },
  { id: '3W', name: '3 Wood', carry: 260, apex: 30, roll: 0.08, spray: 12, cone: 9.5, sweep: 1.75 },
  { id: '5W', name: '5 Wood', carry: 235, apex: 30, roll: 0.07, spray: 11, cone: 9, sweep: 1.812 },
  { id: '4i', name: '4 Iron', carry: 215, apex: 28, roll: 0.06, spray: 9.5, cone: 8.5, sweep: 1.875 },
  { id: '5i', name: '5 Iron', carry: 202, apex: 29, roll: 0.055, spray: 8.75, cone: 8.25, sweep: 1.913 },
  { id: '6i', name: '6 Iron', carry: 189, apex: 30, roll: 0.05, spray: 8, cone: 8, sweep: 1.938 },
  { id: '7i', name: '7 Iron', carry: 176, apex: 31, roll: 0.045, spray: 7.25, cone: 7.75, sweep: 1.975 },
  { id: '8i', name: '8 Iron', carry: 164, apex: 32, roll: 0.04, spray: 6.5, cone: 7.5, sweep: 2.0 },
  { id: '9i', name: '9 Iron', carry: 152, apex: 33, roll: 0.035, spray: 5.75, cone: 7.25, sweep: 2.037 },
  { id: 'PW', name: 'Pitching Wedge', carry: 140, apex: 34, roll: 0.03, spray: 5, cone: 7, sweep: 2.062 },
  { id: 'GW', name: 'Gap Wedge', carry: 128, apex: 33, roll: 0.025, spray: 4.5, cone: 6.75, sweep: 2.1 },
  { id: '52°', name: '52° Wedge', carry: 116, apex: 32, roll: 0.02, spray: 4, cone: 6.5, sweep: 2.125 },
  { id: '56°', name: '56° Wedge', carry: 104, apex: 30, roll: 0.018, spray: 3.5, cone: 6.25, sweep: 2.15 },
  { id: '60°', name: '60° Wedge', carry: 94, apex: 29, roll: 0.015, spray: 3, cone: 6, sweep: 2.188 },
];


export const FULL_CLUBS = CLUBS;
export const clubById = (id: string) => CLUBS.find((c) => c.id === id) ?? CLUBS[0];

/** Aim sweep half-angle (radians). Widens up to 1.8x inside 80 yards so short shots need cleaner timing. */
export function aimConeHalf(club: Club, distToPin: number): number {
  const closeness = 1 - Math.min(1, Math.max(0, (distToPin - 15) / 65)); // 0 at 80+ yds, 1 inside 15
  return (club.cone * (1 + 0.8 * closeness) * Math.PI) / 180;
}

type ClubGroup = 'driver' | 'wood' | 'long' | 'mid' | 'wedge' | 'sand';

function clubGroup(club: Club): ClubGroup {
  if (club.id === 'DR') return 'driver';
  if (club.id.endsWith('W') && club.id !== 'PW' && club.id !== 'GW') return 'wood';
  if (club.id === '4i' || club.id === '5i') return 'long';
  if (club.id.endsWith('i')) return 'mid';
  if (club.id.endsWith('°')) return 'sand';
  return 'wedge';
}

type Range = [number, number];
/** power fraction a swing actually gets from a bad lie, drawn at random within the range each shot */
const LIE_RANGES: Record<'rough' | 'bunker' | 'waste' | 'trees', Record<ClubGroup, Range>> = {
  rough: { driver: [0.55, 0.65], wood: [0.6, 0.72], long: [0.72, 0.82], mid: [0.75, 0.85], wedge: [0.8, 0.88], sand: [0.82, 0.9] },
  bunker: { driver: [0.25, 0.35], wood: [0.3, 0.45], long: [0.5, 0.65], mid: [0.62, 0.75], wedge: [0.66, 0.78], sand: [0.8, 0.9] },
  waste: { driver: [0.65, 0.75], wood: [0.7, 0.8], long: [0.78, 0.86], mid: [0.8, 0.88], wedge: [0.84, 0.92], sand: [0.84, 0.92] },
  trees: { driver: [0.5, 0.65], wood: [0.5, 0.65], long: [0.5, 0.65], mid: [0.5, 0.65], wedge: [0.5, 0.65], sand: [0.5, 0.65] },
};

/** power range [lo, hi] for a swing from this lie: [1, 1] from clean lies */
export function lieRange(surface: string, club: Club): Range {
  const table = LIE_RANGES[surface as keyof typeof LIE_RANGES];
  return table ? table[clubGroup(club)] : [1, 1];
}

/** expected power fraction from a lie (the middle of its range), for planning */
export function lieMid(surface: string, club: Club): number {
  const [lo, hi] = lieRange(surface, club);
  return (lo + hi) / 2;
}

/** Club with full carry closest to (but ideally not past) a desired distance. */
export function clubForDistance(d: number, factor = 1): Club {
  let best = FULL_CLUBS[0];
  for (const c of FULL_CLUBS) {
    if (c.carry * factor >= d - 4) best = c;
  }
  return best;
}
