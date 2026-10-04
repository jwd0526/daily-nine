// Shot simulation shared by the client and the validator bot, so the bot plays
// exactly the game the player plays.

import type { Hole, Surface, Vec } from './types.ts';
import type { Club } from './clubs.ts';
import { lieRange } from './clubs.ts';
import { add, dirFromHeading, dist, len, scale, segDist, sub } from './geom.ts';
import { greenGradient, surfaceAt } from './surface.ts';

export interface ShotInput {
  from: Vec;
  /** Locked aim heading in the hole frame. */
  heading: number;
  club: Club;
  /** Locked power, 0..1.1 (above 1.0 is overswing). */
  power: number;
}

export interface PathPoint { x: number; y: number; h: number; t: number }

export type ShotOutcome = 'rest' | 'holed' | 'water' | 'ob';

export interface ShotResult {
  path: PathPoint[];
  end: Vec;
  outcome: ShotOutcome;
  /** Surface where the ball came to rest (or entered water / OB). */
  surface: Surface;
  /** Carry landing point. */
  landing: Vec;
  hitTree: boolean;
}

/** Yards of drift per mph for a 200-yard carry at a 30-yard apex. */
const WIND_STRENGTH = 1.5;

/** Wind displacement (yards) for a flight of the given carry and apex. */
export function windDrift(hole: Hole, carry: number, apex: number): Vec {
  const k = WIND_STRENGTH * (carry / 200) * (apex / 30);
  return scale(dirFromHeading(hole.wind.dir), hole.wind.mph * k);
}

/** Extra roll (as a fraction of carry) a soft swing gets over a full one: softer swings release. */
const RELEASE = 0.25;

/**
 * How far the ball rolls out, as a fraction of its carry. Full swings carry spin and check up
 * (just the club's own roll); softer swings come in lower and release, so chips run out.
 */
export function rollFraction(club: Club, power: number): number {
  return club.roll + RELEASE * Math.max(0, 1 - Math.min(1, power));
}

/**
 * Power whose carry plus roll covers `total` yards, given a full-swing carry `fullCarry`.
 * `rollScale` is where it lands: ROLL_SCALE.green for approaches, ROLL_SCALE.fairway for layups.
 */
export function powerForTotal(club: Club, fullCarry: number, total: number, rollScale = ROLL_SCALE.green): number {
  let p = Math.min(1.1, total / fullCarry);
  for (let i = 0; i < 6; i++) p = Math.min(1.1, total / (fullCarry * (1 + rollFraction(club, p) * rollScale)));
  return p;
}

/** Overall scale on landing scatter (club `spray` values are multiplied by this). */
const SPRAY_SCALE = 0.65;

/**
 * Radius (yards) of the random landing zone for a full swing: longer clubs spray more,
 * and every club is tighter close to the pin.
 */
export function sprayRadius(club: Club, distToPin: number): number {
  const range = Math.min(1, Math.max(0, distToPin / 300));
  return SPRAY_SCALE * club.spray * (0.5 + 0.65 * range);
}

/** Overswing error: past 100% the face opens or closes a little. */
export function overswingError(power: number, rand: () => number): number {
  if (power <= 1) return 0;
  return (power - 1) * (rand() * 2 - 1) * 0.6;
}

const DECEL: Record<Surface, number> = {
  tee: 3, fairway: 2.2, fringe: 1.5, green: 0.55, rough: 5, trees: 14, waste: 12, bunker: Infinity, water: Infinity, ob: 3,
};
/** landing speed is sized so a ball rolls carry × rollFraction at this deceleration; lower decels roll further */
const LAUNCH_DECEL = 3;
/** how much of its landing speed a ball keeps when it lands on the green or fringe (the rest is lost to spin and the bounce) */
const GREEN_LANDING = 0.55;
/** roll out on a clean landing, as a multiple of carry × rollFraction */
export const ROLL_SCALE = {
  fairway: LAUNCH_DECEL / DECEL.fairway,
  green: (GREEN_LANDING * GREEN_LANDING * LAUNCH_DECEL) / DECEL.green,
};
const G = 10.7; // yd/s²
/** Exaggerates how hard slopes pull a rolling ball on the green, so the break reads clearly. */
const BREAK = 1.6;
/** Cup capture radius (yards): about twice a real cup, so hole-outs happen. */
export const CUP_R = 0.36;
const CUP_MAX_SPEED = 2.4;
const DT = 1 / 60;

export function simulateShot(hole: Hole, input: ShotInput, rand: () => number = Math.random): ShotResult {
  const { from, club } = input;
  const lie = surfaceAt(hole, from);
  const path: PathPoint[] = [{ x: from.x, y: from.y, h: 0, t: 0 }];
  const heading = input.heading + overswingError(input.power, rand);
  const power = Math.min(input.power, 1.1);
  let t = 0;
  let pos = from;
  let hitTree = false;

  // bad lies cost a random slice of power, within the club's range for that lie
  const [lo, hi] = lieRange(lie, club);
  const lieFactor = lo === hi ? lo : lo + (hi - lo) * rand();
  const carry = club.carry * power * lieFactor;
  const apex = club.apex * Math.sqrt(power);
  // Wind plus random scatter inside the reticle (center-weighted; softer swings spray less).
  const sprayR = sprayRadius(club, dist(from, hole.pin)) * Math.min(1, power) * rand();
  const sprayA = rand() * Math.PI * 2;
  const drift = add(windDrift(hole, carry, apex), { x: Math.cos(sprayA) * sprayR, y: Math.sin(sprayA) * sprayR });
  const dir = dirFromHeading(heading);
  const T = 0.9 + carry / 110;
  const steps = Math.max(10, Math.round(T * 30));
  let landed = false;
  const startTrees = new Map(hole.trees.filter((tr) => dist(from, tr) < tr.r).map((tr) => [tr, dist(from, tr)]));
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const p = add(add(from, scale(dir, carry * u)), scale(drift, u * u));
    const h = 4 * apex * u * (1 - u);
    t = T * u;
    // Trees knock the ball down when it's below their canopy. A tree the ball starts
    // under only counts if the shot heads in toward its trunk, not out and away.
    const tree = hole.trees.find((tr) => {
      if (h >= tr.h || dist(p, tr) >= tr.r) return false;
      const startD = startTrees.get(tr);
      return startD === undefined || dist(p, tr) < startD - 0.5;
    });
    path.push({ x: p.x, y: p.y, h, t });
    pos = p;
    if (tree) {
      hitTree = true;
      landed = true;
      break;
    }
  }
  if (!landed) pos = path[path.length - 1];
  const landing = { x: pos.x, y: pos.y };
  const surf = surfaceAt(hole, landing);
  if (surf === 'water' || surf === 'ob') {
    return { path, end: landing, outcome: surf, surface: surf, landing, hitTree };
  }
  if (dist(landing, hole.pin) < CUP_R * 1.5 && !hitTree) {
    return { path, end: hole.pin, outcome: 'holed', surface: 'green', landing, hitTree };
  }
  // Roll: speed after landing depends on club and where it lands.
  const travel = sub(landing, from);
  const rollDir = scale(travel, 1 / (len(travel) || 1));
  let v0 = Math.sqrt(2 * LAUNCH_DECEL * carry * rollFraction(club, power));
  if (hitTree) v0 *= 0.15;
  else if (surf === 'green' || surf === 'fringe') v0 *= GREEN_LANDING;
  else if (surf === 'rough' || surf === 'trees') v0 *= 0.5;
  else if (surf === 'bunker') v0 = 0;
  const vel = scale(rollDir, v0);
  path[path.length - 1].h = 0;

  return roll(hole, path, pos, vel, t, hitTree);
}

function roll(hole: Hole, path: PathPoint[], start: Vec, v0: Vec, t0: number, hitTree: boolean): ShotResult {
  let pos = start;
  let vel = v0;
  let t = t0;
  const landing = { x: start.x, y: start.y };
  let surf = surfaceAt(hole, pos);
  for (let step = 0; step < 60 * 40; step++) {
    const speed = len(vel);
    const onGreen = surf === 'green' || surf === 'fringe';
    const grad = onGreen ? greenGradient(hole, pos) : { x: 0, y: 0 };
    const slopeAcc = scale(grad, -G * BREAK);
    const decel = DECEL[surf];
    if (decel === Infinity) break;
    if (speed < 0.05) {
      // Static friction holds the ball unless the slope is steep.
      // (Threshold sits above the steepest allowed grade, so balls settle rather than creep off.)
      if (len(slopeAcc) < decel * 1.3) break;
    }
    const fric = speed > 0 ? scale(vel, -Math.min(decel, speed / DT) / speed) : { x: 0, y: 0 };
    vel = add(vel, scale(add(fric, slopeAcc), DT));
    const next = add(pos, scale(vel, DT));
    t += DT;

    // Cup capture.
    if (len(vel) < CUP_MAX_SPEED && segDist(hole.pin, pos, next).d < CUP_R) {
      path.push({ x: hole.pin.x, y: hole.pin.y, h: 0, t });
      return { path, end: hole.pin, outcome: 'holed', surface: 'green', landing, hitTree };
    }
    pos = next;
    surf = surfaceAt(hole, pos);
    if (step % 2 === 0) path.push({ x: pos.x, y: pos.y, h: 0, t });
    if (surf === 'water' || surf === 'ob') {
      path.push({ x: pos.x, y: pos.y, h: 0, t });
      return { path, end: pos, outcome: surf, surface: surf, landing, hitTree };
    }
  }
  path.push({ x: pos.x, y: pos.y, h: 0, t });
  return { path, end: pos, outcome: 'rest', surface: surf, landing, hitTree };
}

/**
 * Putting is automatic: once the ball rests on the green the hole is finished,
 * adding strokes by which ring around the pin it stopped in.
 */
export const PUTT_RINGS = [
  { r: 4, putts: 1 },
  { r: 10, putts: 2 },
] as const;
export const MAX_PUTTS = 3;

export function puttsFor(hole: Hole, p: Vec): number {
  const d = dist(p, hole.pin);
  return PUTT_RINGS.find((ring) => d <= ring.r)?.putts ?? MAX_PUTTS;
}

export interface ShotResolution {
  /** Where the next shot is played from. */
  next: Vec;
  /** Penalty strokes added on top of the stroke itself. */
  penalty: number;
  message?: string;
}

/** Apply the rules: water → drop on the line of entry (or drop zone), OB → stroke and distance. */
export function resolveShot(hole: Hole, from: Vec, r: ShotResult): ShotResolution {
  if (r.outcome === 'ob') return { next: from, penalty: 1, message: 'Out of bounds' };
  if (r.outcome === 'water') {
    if (hole.dropZone) return { next: hole.dropZone, penalty: 1, message: 'Water hazard, drop zone' };
    // Walk back along the ball's ground track to the last dry, in-play point.
    for (let i = r.path.length - 1; i >= 0; i--) {
      const p = r.path[i];
      const s = surfaceAt(hole, p);
      if (s !== 'water' && s !== 'ob') {
        // Step a couple of yards further back from the edge.
        const q = r.path[Math.max(0, i - 2)];
        const qs = surfaceAt(hole, q);
        return { next: qs !== 'water' && qs !== 'ob' ? { x: q.x, y: q.y } : { x: p.x, y: p.y }, penalty: 1, message: 'Water hazard' };
      }
    }
    return { next: from, penalty: 1, message: 'Water hazard' };
  }
  return { next: r.end, penalty: 0 };
}
