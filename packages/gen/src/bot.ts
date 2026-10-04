// A simple bot golfer used to validate generated holes. It plays the same physics
// as the player: picks a target (next landing zone or the pin), a club, compensates
// for wind, then adds human-ish noise to aim and power.

import type { Hole, Vec } from './types.ts';
import type { Rng } from './rng.ts';
import { FULL_CLUBS, clubForDistance, lieCarryFactor, type Club } from './clubs.ts';
import { dist, headingOf, sub } from './geom.ts';
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

  // Target: the pin if reachable, otherwise the next landing zone along the hole.
  const factor = lieCarryFactor(lie, FULL_CLUBS[0]);
  const longest = strokeNo === 1 && lie === 'tee' ? FULL_CLUBS[0] : FULL_CLUBS[1];
  const reach = longest.carry * factor + 10;
  let target = hole.pin;
  if (toPin > reach) {
    const sBall = nearestOnCenterline(hole.centerline, ball).s;
    const next = hole.skeleton.slice(1, -1).find((p) => nearestOnCenterline(hole.centerline, p).s > sBall + 30);
    target = next ?? hole.pin;
  }
  const isPin = target === hole.pin;

  // Plan carry so that carry + roll ≈ distance; iterate a couple of times for wind.
  let aim = target;
  let club = clubForDistance(dist(ball, target) * (isPin ? 0.97 : 0.92), factor);
  let power = 1;
  for (let i = 0; i < 3; i++) {
    const want = dist(ball, aim) * (isPin ? 0.97 : 0.92);
    club = clubForDistance(want, lieCarryFactor(lie, club));
    const full = club.carry * lieCarryFactor(lie, club);
    // Plan carry + roll to finish at the target (soft swings release more).
    power = Math.min(1, powerForTotal(club, full, dist(ball, aim) * (isPin ? 1 : 0.97)));
    const drift = windDrift(hole, full * power, club.apex * Math.sqrt(power));
    aim = sub(target, drift);
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
