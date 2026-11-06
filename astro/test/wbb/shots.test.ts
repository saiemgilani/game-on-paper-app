import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor } from '../../src/basketball/config';
import { describeShots, onDrawnCourt, type GameShot } from '../../src/nba/charts/gameShotChart';
import { shotsOf, unlocatedShots } from '../../src/nba/data/game';
import { fromProcessor } from '../../src/resources/nbaGame';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../fixtures/${p}.json`, import.meta.url)).toString());
const game = (id: string) => fromProcessor(read(`wbb/game_${id}_processor`), 'wbb');
const atRim = (p: { xLegacy: number | null; yLegacy: number | null }) => p.xLegacy === 0 && p.yLegacy === 0;
const asShots = (plays: ReturnType<typeof shotsOf>): GameShot[] => {
    const un = unlocatedShots(plays);
    return plays.map((p) => ({ x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || (/three point/i.test(p.text) ? 3 : 2), label: p.text, period: p.period, ...(un.has(p) ? { unlocated: true as const } : {}) }));
};

describe("ESPN's women's (25, 0): rim attempts drawn, impossible ones counted (Decision 10, D29)", () => {
    test('the rule is on for WBB', () => {
        expect(BASKETBALL.wbb.espnRimPlaceholder).toBe(true);
    });
    test("401827362 (2026): Kansas's seven (25, 0) layups are drawn, its one jump shot there is unlocated; TCU's four layups are drawn", () => {
        const g = game('401827362');
        const ku = shotsOf(g.plays, 2305), tcu = shotsOf(g.plays, 2628);
        expect([ku.length, tcu.length]).toEqual([56, 56]);
        expect(ku.filter(atRim).map((p) => p.typeText).sort()).toEqual([...Array(7).fill('LayUpShot'), 'JumpShot'].sort());
        expect([...unlocatedShots(ku)].map((p) => p.typeText)).toEqual(['JumpShot']);
        expect(tcu.filter(atRim).map((p) => p.typeText)).toEqual(['LayUpShot', 'LayUpShot', 'LayUpShot', 'LayUpShot']);
        expect(unlocatedShots(tcu).size).toBe(0);
        const court = courtFor('wbb', 2026);
        const d = describeShots(asShots(ku), court);
        expect(d.startsWith('28 of 56 field goals made, 2 of 12 threes')).toBe(true);
        expect(d.endsWith('; 1 of 56 shots have no recorded location.')).toBe(true); // plan #6's placeholderNote ends the sentence
        expect(asShots(ku).filter((s) => s.unlocated).every((s) => !onDrawnCourt(s, court))).toBe(true);
        expect(asShots(ku).filter((s) => atRim({ xLegacy: s.x, yLegacy: s.y }) && !s.unlocated).every((s) => onDrawnCourt(s, court))).toBe(true);
    });
    test('401702870 (2025): every attempt of both teams at (25, 0), so all of them are unlocated', () => {
        const g = game('401702870');
        for (const [team, n] of [[58, 50], [150, 54]] as const) {
            const s = shotsOf(g.plays, team);
            expect([s.length, s.filter(atRim).length, unlocatedShots(s).size], String(team)).toEqual([n, n, n]);
            expect(describeShots(asShots(s), courtFor('wbb', 2025)).endsWith(`; ${n} of ${n} shots have no recorded location.`)).toBe(true);
        }
    });
    test('without an unlocated attempt the line is exactly the NBA one and no new key appears', () => {
        const s = asShots(shotsOf(game('401827362').plays, 2628));
        expect(describeShots(s, courtFor('wbb', 2026))).not.toContain('no recorded location');
        expect(s.some((x) => 'unlocated' in x)).toBe(false);
    });
    test('the halves-era summaries carry no coordinates at all', () => {
        for (const id of ['400550784', '273130043']) {
            const g = game(id);
            expect([shotsOf(g.plays, Number(g.home.team.id)).length, shotsOf(g.plays, Number(g.away.team.id)).length], id).toEqual([0, 0]);
        }
    });
});
