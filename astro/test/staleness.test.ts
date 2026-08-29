import { describe, expect, test } from 'vitest';
import { assess, kvAge, scoresFromTitle } from '../src/utils/staleness';

const live = { period: 2, clock: '7:12', scores: [14, 10], state: 'in' };

describe('assess', () => {
  test('everything fresh -> nothing behind, no drift', () => {
    const v = assess({ espn: live, kvScoreboard: { view: live, age: 0 }, edge: { status: 'MISS', age: 0, scores: [14, 10] } });
    expect(v).toEqual({ behind: 0, scoreDrift: false, why: [] });
  });
  test('sums the layers and names the biggest first', () => {
    const v = assess({ espn: live, kvScoreboard: { view: live, age: 40 }, edge: { status: 'HIT', age: 55, scores: [14, 10] } });
    expect(v.behind).toBe(95);
    expect(v.why.map((c) => c.layer)).toEqual(['edge HIT', 'kv scoreboard']);
  });
  test('a rendered score that differs from ESPN is drift even at age 0', () => {
    const v = assess({ espn: live, edge: { status: 'HIT', age: 0, scores: [7, 10] } });
    expect(v.scoreDrift).toBe(true);
  });
  test('missing layers contribute nothing', () => {
    expect(assess({ espn: live }).behind).toBe(0);
    expect(assess({ espn: live, kvScoreboard: { view: null, age: null } }).why).toEqual([]);
  });
});

test('kvAge is seconds since fetchedAt, never negative, null when unknown', () => {
  expect(kvAge(1000, 61_000)).toBe(60);
  expect(kvAge(5000, 1000)).toBe(0);
  expect(kvAge(null)).toBeNull();
});

test('scoresFromTitle parses the game page title', () => {
  expect(scoresFromTitle('<html><title>Game: North Carolina 3, TCU 0 | Game on Paper</title>')).toEqual([3, 0]);
  expect(scoresFromTitle('<title>Game: Texas A&amp;M 21, Notre Dame 14 | Game on Paper</title>')).toEqual([21, 14]);
  expect(scoresFromTitle('<title>College Football | Game on Paper</title>')).toBeNull();
});
