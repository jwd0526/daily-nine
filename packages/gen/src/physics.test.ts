import { describe, expect, it } from 'vitest';
import { CLUBS } from './clubs.ts';
import { generateCourse } from './course.ts';
import { puttsFor, simulateShot } from './physics.ts';

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
