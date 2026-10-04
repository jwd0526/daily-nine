import { describe, expect, it } from 'vitest';
import { CLUBS } from './clubs.ts';
import { generateCourse } from './course.ts';
import { lieRange } from './clubs.ts';
import { surfaceAt } from './surface.ts';
import { powerForTotal, puttsFor, ROLL_SCALE, rollFraction, simulateShot } from './physics.ts';

const club = (id: string) => CLUBS.find((c) => c.id === id)!;
const hole = generateCourse('2026-10-02').holes[0];
const calm = { ...hole, wind: { dir: 0, mph: 0 }, trees: [] };
const noScatter = () => 0;

describe('puttsFor', () => {
  it.each([
    [2, 1],
    [6, 2],
    [12, 3],
  ])('%i yds from the pin takes %i putts', (d, want) => {
    expect(puttsFor(hole, { x: hole.pin.x + d, y: hole.pin.y })).toBe(want);
  });
});

describe('simulateShot', () => {
  it('a calm full shot carries the club distance', () => {
    const r = simulateShot(calm, { from: hole.tee, heading: 0, club: club('8i'), power: 1 }, noScatter);
    expect(Math.abs(r.landing.y - hole.tee.y - club('8i').carry)).toBeLessThan(1);
  });

  it('a shot that lands on the cup holes out', () => {
    const pw = club('PW');
    const from = { x: hole.pin.x, y: hole.pin.y - pw.carry * 0.9 };
    // from a tee box so the lie doesn't shorten the carry
    const fromTee = { ...calm, tee: from, teeHeading: 0 };
    expect(simulateShot(fromTee, { from, heading: 0, club: pw, power: 0.9 }, noScatter).outcome).toBe('holed');
  });
});

describe('lie power range', () => {
  // a rough spot on the hole, found by stepping out sideways from the landing zone
  const lz = hole.skeleton[1];
  const rough = [8, 12, 16, 20, 24, 28, -8, -12, -16, -20, -24, -28]
    .map((dx) => ({ x: lz.x + dx, y: lz.y }))
    .find((p) => surfaceAt(hole, p) === 'rough')!;
  const iron = club('8i');
  const carryWith = (r: number) => {
    const shot = simulateShot(calm, { from: rough, heading: 0, club: iron, power: 1 }, () => r);
    return shot.landing.y - rough.y;
  };

  it('finds a rough lie to test from', () => {
    expect(rough).toBeDefined();
  });

  it('carries the low end of the range on the worst draw and the high end on the best', () => {
    const [lo, hi] = lieRange('rough', iron);
    expect(carryWith(0)).toBeCloseTo(iron.carry * lo, 0);
    expect(carryWith(0.999999)).toBeCloseTo(iron.carry * hi, 0);
  });
});

describe('trees', () => {
  const tree = { x: 0, y: 0, r: 4, h: 18 };
  const underTree = { ...calm, trees: [tree] };
  const from = { x: 0, y: 2 }; // 2 yds from the trunk, under the canopy

  it('does not clip the tree the ball starts under when aimed away from it', () => {
    expect(simulateShot(underTree, { from, heading: 0, club: club('PW'), power: 0.5 }, noScatter).hitTree).toBe(false);
  });

  it('still clips it when aimed back through the trunk', () => {
    expect(simulateShot(underTree, { from, heading: Math.PI, club: club('PW'), power: 0.5 }, noScatter).hitTree).toBe(true);
  });
});

describe('roll out', () => {
  const wedge = club('60°');

  it('a full swing rolls only the club amount', () => {
    expect(rollFraction(wedge, 1)).toBe(wedge.roll);
  });

  it('softer swings release more', () => {
    expect(rollFraction(wedge, 0.5)).toBeGreaterThan(rollFraction(wedge, 0.8));
    expect(rollFraction(wedge, 0.8)).toBeGreaterThan(rollFraction(wedge, 1));
  });

  it('a 50 yd wedge rolls out several yards, a full one barely', () => {
    const chip = powerForTotal(wedge, wedge.carry, 50, 1);
    const chipRoll = wedge.carry * chip * rollFraction(wedge, chip);
    const fullRoll = wedge.carry * rollFraction(wedge, 1);
    expect(chipRoll).toBeGreaterThan(5);
    expect(fullRoll).toBeLessThan(2);
  });

  it.each([
    ['green', 25], ['green', 50], ['green', 90], ['fairway', 50], ['fairway', 90],
  ] as const)('powerForTotal lands on %s and finishes at %i yds', (surface, total) => {
    const p = powerForTotal(wedge, wedge.carry, total, ROLL_SCALE[surface]);
    const carry = wedge.carry * p;
    expect(carry * (1 + rollFraction(wedge, p) * ROLL_SCALE[surface])).toBeCloseTo(total, 0);
  });

  it('balls roll further than the club alone says on fairways and greens', () => {
    expect(ROLL_SCALE.fairway).toBeGreaterThan(1);
    expect(ROLL_SCALE.green).toBeGreaterThan(1);
  });
});
