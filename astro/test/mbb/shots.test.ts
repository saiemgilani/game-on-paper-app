import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { courtFor } from '../../src/basketball/config';
import { describeShots, onDrawnCourt, type GameShot } from '../../src/nba/charts/gameShotChart';
import { shotsOf, unlocatedShots } from '../../src/nba/data/game';
import { fromProcessor } from '../../src/resources/nbaGame';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../fixtures/${p}.json`, import.meta.url)).toString());
const game = (id: string) => fromProcessor(read(`mbb/game_${id}_processor`), 'mbb');
const atRim = (p: { xLegacy: number | null; yLegacy: number | null }) => p.xLegacy === 0 && p.yLegacy === 0;
const asShots = (plays: ReturnType<typeof shotsOf>): GameShot[] => {
    const un = unlocatedShots(plays);
    return plays.map((p) => ({ x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || (/three point/i.test(p.text) ? 3 : 2), label: p.text, period: p.period, ...(un.has(p) ? { unlocated: true as const } : {}) }));
};

describe("ESPN's college (25, 0): a rim attempt is drawn, an impossible one is counted (Decision 6, D29)", () => {
    test('401808271 (2026): the one (25, 0) layup is a rim attempt, nothing is unlocated', () => {
        const g = game('401808271');
        const tenn = shotsOf(g.plays, 2633);
        expect(tenn.filter(atRim).map((p) => p.typeText)).toEqual(['LayUpShot']);
        expect(unlocatedShots(tenn).size).toBe(0);
        expect(unlocatedShots(shotsOf(g.plays, 333)).size).toBe(0);
    });
    test('401744223 (2025): the jump shot at (25, 0) on each side is unlocated, the two layups are drawn', () => {
        const g = game('401744223');
        const odu = shotsOf(g.plays, 295), txst = shotsOf(g.plays, 326);
        expect([odu.length, txst.length]).toEqual([60, 62]);
        expect([...unlocatedShots(odu)].map((p) => p.typeText)).toEqual(['JumpShot']);
        expect([...unlocatedShots(txst)].map((p) => p.typeText)).toEqual(['JumpShot']);
        expect(txst.filter((p) => atRim(p) && !unlocatedShots(txst).has(p)).map((p) => p.typeText)).toEqual(['LayUpShot', 'LayUpShot']);
        const court = courtFor('mbb', 2025);
        const d = describeShots(asShots(odu), court);
        expect(d.startsWith('21 of 60 field goals made, 8 of 23 threes')).toBe(true);
        expect(d.endsWith('; 1 of 60 shots have no recorded location.')).toBe(true); // plan #6's placeholderNote ends the sentence
        expect(asShots(odu).filter((s) => s.unlocated).every((s) => !onDrawnCourt(s, court))).toBe(true);
    });
    test('401706366 (2025): every attempt of both teams at (25, 0), so all of them are unlocated', () => {
        const g = game('401706366');
        for (const [team, n] of [[2006, 62], [2711, 74]] as const) {
            const s = shotsOf(g.plays, team);
            expect([s.length, s.filter(atRim).length, unlocatedShots(s).size]).toEqual([n, n, n]);
            expect(describeShots(asShots(s), courtFor('mbb', 2025)).endsWith(`; ${n} of ${n} shots have no recorded location.`)).toBe(true);
        }
    });
    test("summary_mbb.json's real DunkShots at (25, 0) would be drawn: rim types are never unlocated in a located game", () => {
        const p = (typeText: string, x: number, y: number, text = '') => ({ xLegacy: x, yLegacy: y, typeText, text }) as any;
        const located = [...Array(54)].map((_, i) => p('JumpShot', 10 * (i + 1), 50));
        const dunks = [...Array(4)].map(() => p('DunkShot', 0, 0, 'made Dunk.'));
        expect(unlocatedShots([...located, ...dunks]).size).toBe(0);
        expect(unlocatedShots([...located, p('JumpShot', 0, 0, 'missed Jumper.')]).size).toBe(1);
        expect(unlocatedShots([...located, p('LayUpShot', 0, 0, 'missed Three Point Jumper.')]).size).toBe(1); // a three is never at the rim
    });
    test('without an unlocated attempt the line is exactly the NBA one', () => {
        const s = asShots(shotsOf(game('401808271').plays, 333));
        expect(describeShots(s, courtFor('mbb', 2026))).not.toContain('no recorded location');
        expect(s.some((x) => 'unlocated' in x)).toBe(false); // no new key reaches an island prop
    });
});
