// A simple bot golfer used to validate generated holes. It plays the same physics
// as the player: picks a target (next landing zone or the pin), a club, compensates
// for wind, then adds human-ish noise to aim and power.

import type { Hole, Vec } from './types.ts';
import type { Rng } from './rng.ts';
import { FULL_CLUBS, lieMid, type Club } from './clubs.ts';
import { add, dist, headingOf, norm, scale, sub } from './geom.ts';
import { powerForTotal, puttsFor, resolveShot, simulateShot, windDrift } from './physics.ts';
import { nearestOnCenterline, surfaceAt } from './surface.ts';

export interface BotSkill {
  /** Aim error standard deviation, degrees. */
  aimSd: number;
  /** Power error standard deviation (fraction). */
  powerSd: number;
}

export const PERFECT: BotSkill = { aimSd: 0, powerSd: 0 };
export const AVERAGE: BotSkill = { aimSd: 2.2, powerSd: 0.045 };

export interface BotRound {
  strokes: number;
  penalties: number;
  /** Strokes taken to first reach the green (Infinity if never). */
  toGreen: number;
  holed: boolean;
}

export interface PlannedShot {
  club: Club;
  heading: number;
  power: number;
}

const DEG = Math.PI / 180;

/** The shot a sensible player would try from `ball` (no execution noise). */
export function planShot(hole: Hole, ball: Vec, strokeNo: number): PlannedShot {
  const lie = surfaceAt(hole, ball);
  const toPin = dist(ball, hole.pin);

  // expected carry from this lie (bad lies cost power, more so for long clubs)
  const reachOf = (c: Club) => c.carry * lieMid(lie, c);
  // driver only off the tee; otherwise the shortest club that still gets there
  const bag = strokeNo === 1 && lie === 'tee' ? FULL_CLUBS : FULL_CLUBS.slice(1);
  const pick = (want: number) => bag.reduce((best, c) => (reachOf(c) >= want - 4 ? c : best), bag[0]);

  // Target: the pin if reachable, otherwise the next landing zone along the hole.
  const reach = Math.max(...bag.map(reachOf)) + 10;
  let target = hole.pin;
  if (toPin > reach) {
    const sBall = nearestOnCenterline(hole.centerline, ball).s;
    const next = hole.skeleton.slice(1, -1).find((p) => nearestOnCenterline(hole.centerline, p).s > sBall + 30);
    target = next ?? hole.pin;
  }
  const isPin = target === hole.pin;

  // Plan carry so that carry + roll ≈ distance; iterate a couple of times for wind.
  let aim = target;
  let club = pick(dist(ball, target) * (isPin ? 0.97 : 0.92));
  let power = 1;
  for (let i = 0; i < 3; i++) {
    const want = dist(ball, aim) * (isPin ? 0.97 : 0.92);
    club = pick(want);
    const full = reachOf(club);
    // Plan carry + roll to finish at the target: pins land on the green, layups on fairway.
    power = Math.min(1, powerForTotal(club, full, dist(ball, aim), isPin ? 'green' : 'fairway'));
    const drift = windDrift(hole, full * power, club.apex * Math.sqrt(power));
    aim = sub(target, drift);
  }

  // approaches: if the run-up would land short of the green (fringe, rough, a front bunker), carry it onto the green instead
  if (isPin) {
    const full = reachOf(club);
    const dir = norm(sub(aim, ball));
    const landing = (carry: number) =>
      add(add(ball, scale(dir, carry)), windDrift(hole, carry, club.apex * Math.sqrt(carry / full)));
    if (surfaceAt(hole, landing(full * power)) !== 'green') {
      for (let carry = full * power; carry <= Math.min(full, dist(ball, aim) + 8); carry += 1) {
        if (surfaceAt(hole, landing(carry)) === 'green') { power = carry / full; break; }
      }
    }
  }
  return { club, heading: headingOf(sub(aim, ball)), power };
}

export function botPlayHole(hole: Hole, rng: Rng, skill: BotSkill, maxOver = 5): BotRound {
  let ball: Vec = hole.tee;
  let strokes = 0, penalties = 0;
  const rand = () => rng.float();
  while (strokes < hole.par + maxOver) {
    const plan = planShot(hole, ball, strokes + 1);
    const heading = plan.heading + rng.gauss(0, skill.aimSd) * DEG;
    const power = Math.max(0.2, Math.min(1.1, plan.power + rng.gauss(0, skill.powerSd)));
    const r = simulateShot(hole, { from: ball, heading, power, club: plan.club }, rand);
    strokes++;
    // reaching the green ends the hole (holed out, or putts by ring), so toGreen is just strokes so far
    if (r.outcome === 'holed') return { strokes, penalties, toGreen: strokes, holed: true };
    const res = resolveShot(hole, ball, r);
    strokes += res.penalty;
    penalties += res.penalty;
    ball = res.next;
    if (surfaceAt(hole, ball) === 'green') {
      return { strokes: strokes + puttsFor(hole, ball), penalties, toGreen: strokes, holed: true };
    }
  }
  return { strokes, penalties, toGreen: Infinity, holed: false };
}
