import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
    formatPlayerMetric, gameStatLine, isEspnAthleteId, isGsisId, isPlayerPath,
    numberOrNull, percentileOf, playerPath, rollUpSeasons, SPLIT_PARTITIONS,
    totalGameLog, type SeasonRow,
} from '../src/utils/players';

// The arithmetic the player pages do over the Data API's player-keyed reads,
// against the REAL bodies those routes return (captured 2026-09-19 from the
// ingested rows; see fixtures/README.md). The reconciliation assertions are the
// point: `/games` and `/splits` aggregate the same pbp population, so the game
// log has to sum to the `all` split exactly, and each pair of split groups has
// to partition it. If a producer change breaks that, it breaks here and not on
// a live page.
const cfb = JSON.parse(readFileSync(new URL('./fixtures/player-cfb-4433971-2024.json', import.meta.url)).toString());
const nfl = JSON.parse(readFileSync(new URL('./fixtures/player-nfl-16800-2024.json', import.meta.url)).toString());
const CASES = [['cfb', cfb], ['nfl', nfl]] as const;

describe('the gated path shape', () => {
    test('matches both leagues segment-exact', () => {
        for (const p of ['/players/4433971', '/players/', '/players', '/nfl/players/16800', '/nfl/players/00-0031381']) {
            expect(isPlayerPath(p), p).toBe(true);
        }
        for (const p of ['/', '/nfl', '/playersx', '/year/2025/players/passing', '/nfl/year/2024/players/passing', '/team/183', '/game/401634304']) {
            expect(isPlayerPath(p), p).toBe(false);
        }
    });

    test('playerPath prefixes the league and carries the season', () => {
        expect(playerPath('cfb', 4433971)).toBe('/players/4433971');
        expect(playerPath('nfl', '16800', 2024)).toBe('/nfl/players/16800?season=2024');
        expect(playerPath('cfb', '4433971', null)).toBe('/players/4433971');
    });

    test('id shapes: ESPN athlete ids are digits, gsis ids are the nflverse form', () => {
        expect(isEspnAthleteId('4433971')).toBe(true);
        expect(isEspnAthleteId('16800')).toBe(true);
        for (const bad of ['00-0031381', '4433971.0', 'kyle', '', '-1', '1e5']) expect(isEspnAthleteId(bad), bad).toBe(false);
        expect(isGsisId('00-0031381')).toBe(true);
        for (const bad of ['16800', '00-003138', '0-0031381', 'AdamDa01']) expect(isGsisId(bad), bad).toBe(false);
    });
});

describe.each(CASES)('%s reconciliation', (_league, fx) => {
    const games = fx.games.data;
    const splits: any[] = fx.splits.data;
    const all = splits.find((s) => s.split === 'all');

    test('the season summary is the game log summed, and equals the all-plays split', () => {
        const totals = totalGameLog(games);
        expect(totals.games).toBe(games.length);
        expect(totals.plays).toBe(all.plays);
        expect(totals.successes).toBe(all.successes);
        expect(totals.epa).toBeCloseTo(all.epa, 6);
        // the rates are recomputed from the counts, never carried
        expect(totals.epa_per_play).toBeCloseTo(all.epa / all.plays, 10);
        expect(totals.success_rate).toBeCloseTo(all.successes / all.plays, 10);
    });

    test('every split group partitions the all-plays population', () => {
        for (const group of SPLIT_PARTITIONS) {
            const rows = group.map((k) => splits.find((s) => s.split === k));
            expect(rows.every(Boolean), group.join('+')).toBe(true);
            expect(rows.reduce((t, r) => t + r.plays, 0), group.join('+')).toBe(all.plays);
            expect(rows.reduce((t, r) => t + r.successes, 0), group.join('+')).toBe(all.successes);
        }
    });

    test("every split's published rates recompute from the counts beside them", () => {
        for (const s of splits) {
            if (!s.plays) { expect(s.epa_per_play).toBeNull(); continue; }
            expect(s.epa_per_play, s.split).toBeCloseTo(s.epa / s.plays, 10);
            expect(s.success_rate, s.split).toBeCloseTo(s.successes / s.plays, 10);
        }
    });

    test('per-role plays sum to the game total on every game-log row', () => {
        for (const g of games) {
            expect(g.passer_plays + g.rusher_plays + g.receiver_plays, String(g.game_id)).toBe(g.plays);
        }
    });
});

describe('career roll-up', () => {
    const rows = (fx: any, category: string): SeasonRow[] => fx.seasons.data.filter((r: SeasonRow) => r.category === category);

    test('additive columns sum and the rates recompute from the sums', () => {
        const passing = rows(cfb, 'passing');
        expect(passing.length).toBe(4); // 2021-2024
        const career = rollUpSeasons(passing)!;
        expect(career).not.toBeNull();
        for (const k of ['plays', 'dropbacks', 'TEPA', 'yards', 'comp', 'att', 'games']) {
            expect(career[k], k).toBeCloseTo(passing.reduce((t, r) => t + Number(r[k] ?? 0), 0), 6);
        }
        // a passer's EPA/play is per DROPBACK -- the leaderboards label it EPA/DB
        // and the API documents the quirk; dividing by plays would publish a
        // different number under the same header
        expect(career.EPAplay as number).toBeCloseTo(Number(career.TEPA) / Number(career.dropbacks), 10);
        expect(career.EPAplay as number).not.toBeCloseTo(Number(career.TEPA) / Number(career.plays), 4);
        expect(career.comppct as number).toBeCloseTo(Number(career.comp) / Number(career.att), 10);
        expect(career.yardsdropback as number).toBeCloseTo(Number(career.sack_adj_yards) / Number(career.dropbacks), 10);
    });

    test('success rate is play-weighted, not an average of averages', () => {
        const recv = rows(nfl, 'receiving');
        const career = rollUpSeasons(recv)!;
        const weighted = recv.reduce((t, r) => t + Number(r.success) * Number(r.plays), 0) / recv.reduce((t, r) => t + Number(r.plays), 0);
        expect(career.success as number).toBeCloseTo(weighted, 12);
        const naive = recv.reduce((t, r) => t + Number(r.success), 0) / recv.length;
        expect(career.success as number).not.toBeCloseTo(naive, 6);
        // receiving EPA/play is per play, and catch % is catches over targets
        expect(career.EPAplay as number).toBeCloseTo(Number(career.TEPA) / Number(career.plays), 10);
        expect(career.catchpct as number).toBeCloseTo(Number(career.comp) / Number(career.targets), 10);
    });

    test('a single row has nothing to roll up', () => {
        expect(rollUpSeasons(rows(nfl, 'passing'))).toBeNull(); // one 2022 dropback
        expect(rollUpSeasons([])).toBeNull();
    });
});

describe('formatting', () => {
    test('a metric renders exactly as the season leaderboards render it', () => {
        const row = cfb.seasons.data.find((r: any) => r.category === 'passing' && r.season === 2024);
        expect(formatPlayerMetric('passing', 'EPAplay', row.EPAplay)).toBe('0.31');
        expect(formatPlayerMetric('passing', 'dropbacks', row.dropbacks)).toBe('558');
        expect(formatPlayerMetric('passing', 'sack_adj_yards', row.sack_adj_yards)).toBe('4191.0');
        // a percent column carries its sign, scaled by the leaderboards' multiplier
        expect(formatPlayerMetric('passing', 'success', row.success)).toBe('54.2%');
        expect(formatPlayerMetric('passing', 'EPAplay', null)).toBe('—');
        expect(formatPlayerMetric('receiving', 'catchpct', 0.6666666)).toBe('66.7%');
    });

    test('the percentile is the producer\'s _pct, clamped, or null', () => {
        const row = cfb.seasons.data.find((r: any) => r.category === 'passing' && r.season === 2024);
        expect(percentileOf(row, 'EPAplay')).toBeCloseTo(94.6969696969697, 10);
        expect(percentileOf(row, 'games')).toBeNull();
        expect(percentileOf({ x_pct: 140 }, 'x')).toBe(100);
        expect(percentileOf({ x_pct: -3 }, 'x')).toBe(0);
    });

    test('the stat line reads the league its box came from', () => {
        const cfbGame = cfb.games.data[0];
        expect(gameStatLine(cfbGame.box, 'cfb')).toBe('27/39, 354 yds, 4 TD, 1 INT; 5 car, -1 yds, 0 TD');
        // the NFL box is nflverse weekly stats: different keys, numeric values
        const nflGame = nfl.games.data[0];
        expect(gameStatLine(nflGame.box, 'nfl')).toBe('5/6 tgt, 59 yds, 0 TD');
        expect(gameStatLine(undefined, 'cfb')).toBe('');
        // ESPN's box is STRINGS, so `"0"` and `"0/0"` are truthy: counting on
        // truthiness printed a phantom line for an empty category
        expect(gameStatLine({ 'completions/passingAttempts': '0/0', rushingAttempts: '0', receptions: '0' }, 'cfb')).toBe('');
        expect(gameStatLine({ rushingAttempts: '3', rushingYards: '12', rushingTouchdowns: '0' }, 'cfb'))
            .toBe('3 car, 12 yds, 0 TD');
        // reading a CFB box as an NFL one must produce nothing, not a wrong line
        expect(gameStatLine(cfbGame.box, 'nfl')).toBe('');
    });

    test('numberOrNull keeps 0 and rejects the API\'s empty markers', () => {
        expect(numberOrNull(0)).toBe(0);
        for (const v of [null, undefined, '', 'NA', 'x', NaN]) expect(numberOrNull(v), String(v)).toBeNull();
    });
});
