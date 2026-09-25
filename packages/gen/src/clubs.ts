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

/** Lofted wedges that splash out of sand cleanly. */
const SAND_CLUBS = new Set(['52°', '56°', '60°']);

export const FULL_CLUBS = CLUBS;
export const clubById = (id: string) => CLUBS.find((c) => c.id === id) ?? CLUBS[0];

/** Carry multiplier for hitting from a given lie. */
export function lieCarryFactor(surface: string, club: Club): number {
  switch (surface) {
    case 'rough': return 0.88;
    case 'trees': return 0.65;
    case 'waste': return 0.85;
    case 'bunker': return SAND_CLUBS.has(club.id) ? 0.92 : 0.75;
    default: return 1;
  }
}

/** Club with full carry closest to (but ideally not past) a desired distance. */
export function clubForDistance(d: number, factor = 1): Club {
  let best = FULL_CLUBS[0];
  for (const c of FULL_CLUBS) {
    if (c.carry * factor >= d - 4) best = c;
  }
  return best;
}
