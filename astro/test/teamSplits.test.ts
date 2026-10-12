import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { TEAM_SPLIT_MIN_PLAYS, TEAM_SPLIT_ROWS, teamSplitColumns, teamSplitRows } from '../src/utils/teamSplits';

// The Data API's own 2025 team_tendencies rows, every column (fixtures/README.md):
// Alabama (cfb 333) and Kansas City (nfl 12).
const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/team-tendencies-${name}-2025.json`, import.meta.url)).toString()).data[0];
const rows = { cfb: fixture('cfb-333'), nfl: fixture('nfl-12') } as const;
// ...and every team's row for the season, the rank population (the page's own select)
const seasonOf = (league: string) =>
    JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/team-tendencies-${league}-2025.json.gz`, import.meta.url))).toString()).data;
const season = { cfb: seasonOf('cfb'), nfl: seasonOf('nfl') } as const;

const byKey = (league: 'cfb' | 'nfl', side: 'off' | 'def') =>
    Object.fromEntries(teamSplitRows(rows[league], side).map((r) => [r.key, r]));

describe.each(['cfb', 'nfl'] as const)('%s', (league) => {
    const row = rows[league];

    test('Overall is first and reads the bare columns', () => {
        const off = teamSplitRows(row, 'off')[0];
        expect(off.label).toBe('Overall');
        expect(off.plays).toBe(row.plays);
        expect(off.epa_per_play).toBe(row.epa_per_play);
        expect(off.pass_rate).toBe(row.pass_rate);
        expect(off.success_rate).toBe(row.success_rate);
        const def = teamSplitRows(row, 'def')[0];
        expect(def.plays).toBe(row.def_plays);
        expect(def.epa_per_play).toBe(row.def_epa_per_play);
    });

    test('Leading, Tied and Trailing partition Overall on both sides', () => {
        for (const side of ['off', 'def'] as const) {
            const r = byKey(league, side);
            expect(r.leading.plays! + r.tied.plays! + r.trailing.plays!, side).toBe(r.overall.plays);
            expect(r.own_half.plays! + r.opp_half.plays!, side).toBe(r.overall.plays);
        }
    });

    test('defense: Leading reads def_*_trailing and Trailing reads def_*_leading', () => {
        const r = byKey(league, 'def');
        expect(r.leading.plays).toBe(row.def_plays_trailing);
        expect(r.leading.epa_per_play).toBe(row.def_epa_per_play_trailing);
        expect(r.trailing.plays).toBe(row.def_plays_leading);
        expect(r.trailing.success_rate).toBe(row.def_success_rate_leading);
        expect(r.tied.pass_rate).toBe(row.def_pass_rate_tied);
    });

    test('defense: Own half reads def_*_opp_half and Opponent half reads def_*_own_half', () => {
        const r = byKey(league, 'def');
        expect(r.own_half.plays).toBe(row.def_plays_opp_half);
        expect(r.own_half.epa_per_play).toBe(row.def_epa_per_play_opp_half);
        expect(r.opp_half.plays).toBe(row.def_plays_own_half);
        expect(r.opp_half.success_rate).toBe(row.def_success_rate_own_half);
    });

    test('defense: downs, red zone, one score and context rows read the same-named def_ column', () => {
        const r = byKey(league, 'def');
        for (const k of ['d1', 'd2', 'd3_short', 'd3_medium', 'd3_long', 'd4', 'red_zone', 'one_score', 'home', 'away', 'neutral_site']) {
            expect(r[k].plays, k).toBe(row[`def_plays_${k}`]);
            expect(r[k].epa_per_play, k).toBe(row[`def_plays_${k}`] === 0 ? null : row[`def_epa_per_play_${k}`]);
        }
    });

    test('the down rows: Early downs over 1st and 2nd, Late downs over the 3rd-down buckets and 4th', () => {
        expect(teamSplitRows(row, 'off').slice(0, 9).map((r) => [r.label, !!r.sub])).toEqual([
            ['Overall', false], ['Early downs', false], ['1st down', true], ['2nd down', true],
            ['Late downs', false], ['3rd & short', true], ['3rd & medium', true], ['3rd & long', true], ['4th down', true],
        ]);
    });

    test('Early downs read the early_down columns, which are 1st plus 2nd down', () => {
        for (const [side, p] of [['off', ''], ['def', 'def_']] as const) {
            const r = byKey(league, side);
            expect(r.early_down, side).toMatchObject({
                plays: row[`${p}plays_early_down`], pass_rate: row[`${p}pass_rate_early_down`],
                epa_per_play: row[`${p}epa_per_play_early_down`], success_rate: row[`${p}success_rate_early_down`],
            });
            expect(r.d1.plays! + r.d2.plays!, side).toBe(r.early_down.plays);
        }
    });

    test('Late downs are the 3rd- and 4th-down counts summed and re-rated', () => {
        for (const [side, p] of [['off', ''], ['def', 'def_']] as const) {
            const sum = (m: string) => row[`${p}${m}_d3`] + row[`${p}${m}_d4`];
            const late = byKey(league, side).late_down;
            expect(late.plays, side).toBe(sum('plays'));
            expect(late.pass_rate, side).toBeCloseTo(sum('passes') / sum('plays'), 12);
            expect(late.epa_per_play, side).toBeCloseTo(sum('epa') / sum('plays'), 12);
            expect(late.success_rate, side).toBeCloseTo(sum('successes') / sum('plays'), 12);
            // and the 3rd-down buckets plus 4th down are inside it
            const r = byKey(league, side);
            expect(r.d3_short.plays! + r.d3_medium.plays! + r.d3_long.plays! + r.d4.plays!, side).toBeLessThanOrEqual(late.plays!);
        }
    });

    test('every select column exists in the real row (an unknown column is a 400 upstream)', () => {
        const keys = new Set(Object.keys(row));
        expect(teamSplitColumns(league).filter((c) => !keys.has(c))).toEqual([]);
    });
});

describe('league and zero-play rows', () => {
    test('cfb has 20 rows ending in vs Ranked; nfl has no vs Ranked column or row', () => {
        expect(teamSplitRows(rows.cfb, 'off')).toHaveLength(20);
        expect(teamSplitRows(rows.cfb, 'off').at(-1)?.label).toBe('vs Ranked');
        expect(teamSplitColumns('nfl').filter((c) => c.includes('vs_ranked'))).toEqual([]);
        expect(teamSplitRows(rows.nfl, 'off').map((r) => r.key)).not.toContain('vs_ranked');
        expect(teamSplitRows(rows.nfl, 'off')).toHaveLength(TEAM_SPLIT_ROWS.length - 1);
    });

    test('a split with zero plays keeps its row with null rates', () => {
        // a copy of the real row with its neutral-site split emptied; a stale rate must not leak through
        const r = Object.fromEntries(teamSplitRows({ ...rows.cfb, plays_neutral_site: 0, epa_per_play_neutral_site: 0.5 }, 'off').map((x) => [x.key, x]));
        expect(r.neutral_site.plays).toBe(0);
        expect(r.neutral_site).toMatchObject({ pass_rate: null, epa_per_play: null, success_rate: null });
    });

    test('no row, no rows', () => {
        expect(teamSplitRows(undefined, 'off')).toEqual([]);
    });
});

describe.each([['cfb', 333, 138], ['nfl', 12, 32]] as const)('%s ranks against the season', (league, id, qualifying) => {
    const all = season[league];
    const team = all.find((t: any) => t.pos_team_id === id);
    const qualified = all.filter((t: any) => t.plays >= TEAM_SPLIT_MIN_PLAYS);
    // the rank written out longhand: one plus the qualifying teams strictly better
    const expected = (vals: (number | null)[], v: number, lowerIsBetter: boolean) =>
        1 + vals.filter((x) => x !== null && (lowerIsBetter ? x < v : x > v)).length;

    test(`${qualifying} teams qualify (${TEAM_SPLIT_MIN_PLAYS}+ plays)`, () => {
        expect(qualified).toHaveLength(qualifying);
        expect(teamSplitRows(team, 'off', all)[0].ranked).toBe(qualifying);
    });

    test('offense ranks high-is-best, defense low-is-best, on every split', () => {
        for (const side of ['off', 'def'] as const) {
            const mine = teamSplitRows(team, side, all);
            const theirs = qualified.map((t: any) => Object.fromEntries(teamSplitRows(t, side).map((r) => [r.key, r])));
            for (const r of mine) {
                if (r.epa_per_play === null) continue;
                const field = (m: 'epa_per_play' | 'success_rate') => theirs.map((t: any) => t[r.key]?.[m] ?? null);
                expect(r.epa_rank, `${side} ${r.key}`).toBe(expected(field('epa_per_play'), r.epa_per_play, side === 'def'));
                expect(r.success_rank, `${side} ${r.key}`).toBe(expected(field('success_rate'), r.success_rate!, side === 'def'));
                expect(r.ranked, `${side} ${r.key}`).toBe(field('epa_per_play').filter((x: any) => x !== null).length);
            }
        }
    });

    test('rank 1 is the best qualifying value, on both sides', () => {
        const best = (side: 'off' | 'def') => qualified.toSorted((a: any, b: any) =>
            side === 'off' ? b.epa_per_play - a.epa_per_play : a.def_epa_per_play - b.def_epa_per_play)[0];
        expect(teamSplitRows(best('off'), 'off', all)[0].epa_rank).toBe(1);
        expect(teamSplitRows(best('def'), 'def', all)[0].epa_rank).toBe(1);
    });

    test('no season rows: no ranks', () => {
        expect(teamSplitRows(team, 'off').every((r) => r.epa_rank === null && r.success_rank === null)).toBe(true);
    });
});

test('a team below the minimum is shown, not ranked', () => {
    const small = season.cfb.find((t: any) => t.plays < TEAM_SPLIT_MIN_PLAYS);
    const r = teamSplitRows(small, 'off', season.cfb);
    expect(r[0].plays).toBe(small.plays);
    expect(r.every((x) => x.epa_rank === null && x.success_rank === null)).toBe(true);
});
