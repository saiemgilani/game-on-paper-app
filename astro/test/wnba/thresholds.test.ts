// astro/test/wnba/thresholds.test.ts
// Season-total bars keep the NBA's per-game rate (100 FGA, 50 3PA per 82 games) over each season's own length.
import { describe, expect, test } from 'vitest';
import { BASKETBALL, rankMins } from '../../src/basketball/config';
import { playerSeasonsFromRows, headshotsFromRows } from '../../src/nba/adapters';
import { describeScatter } from '../../src/nba/charts/scatterChart';
import { describeGames } from '../../src/nba/charts/gameStrip';
import { rankTable, RANK_MIN } from '../../src/nba/data/ranks';
import { scatterPoints } from '../../src/nba/data/scatter';
import { leaderBoards, NBA_LEADER_BARS } from '../../src/nba/data/leaders';
import { seasonPlayerGamesFromRows } from '../../src/nba/adapters';
import { wnbaSeasonGames } from '../../src/nba/seasonRange';
import { playerGames2026, seasonPlayers } from './dashboardFixtures';

// regular-season games per team, measured 2026-10-12: distinct 102… game ids per team in wehoop-wnba-stats-data shots and
// player game logs (c6e1870); every team played the same number in every season
const GAMES: Record<number, number> = {
    1997: 28, 1998: 30, 1999: 32, 2000: 32, 2001: 32, 2002: 32, 2003: 34, 2004: 34, 2005: 34, 2006: 34, 2007: 34, 2008: 34, 2009: 34,
    2010: 34, 2011: 34, 2012: 34, 2013: 34, 2014: 34, 2015: 34, 2016: 34, 2017: 34, 2018: 34, 2019: 34, 2020: 22, 2021: 32, 2022: 36,
    2023: 40, 2024: 40, 2025: 44, 2026: 44,
};

describe('thresholds by season length', () => {
    test('WNBA season lengths, 1997-2026; a season not yet listed takes the latest', () => {
        for (const [s, g] of Object.entries(GAMES)) expect(wnbaSeasonGames(Number(s)), s).toBe(g);
        expect(wnbaSeasonGames(2027)).toBe(44);
        expect(BASKETBALL.wnba.regularSeasonGames(2026)).toBe(44);
    });
    test('rankMins: the NBA is 100 / 50 in every season; the WNBA scales', () => {
        for (const s of [1998, 1999, 2012, 2026]) expect(rankMins('nba', s)).toEqual(RANK_MIN);
        expect(RANK_MIN).toEqual({ fga: 100, fg3a: 50 });
        expect([1997, 2003, 2020, 2022, 2024, 2026].map((s) => rankMins('wnba', s))).toEqual([
            { fga: 34, fg3a: 17 }, { fga: 41, fg3a: 21 }, { fga: 27, fg3a: 13 }, { fga: 44, fg3a: 22 }, { fga: 49, fg3a: 24 }, { fga: 54, fg3a: 27 },
        ]);
    });
    test('2026 rank tables and the scatter take exactly the players at or over the bars', () => {
        const rows = seasonPlayers(2026);
        const players = playerSeasonsFromRows(rows);
        const min = rankMins('wnba', 2026);
        expect(rankTable(players, 'fga', min)).toHaveLength(players.filter((p) => p.attempts >= 54).length);
        expect(rankTable(players, 'fg3Pct', min)).toHaveLength(players.filter((p) => p.attempts >= 54 && p.fg3a >= 27).length);
        expect(rankTable(players, 'fga', min).length).toBeGreaterThan(rankTable(players, 'fga').length); // the NBA bar would drop players
        const pts = scatterPoints(players, headshotsFromRows(rows), null, { min });
        expect(pts).toHaveLength(players.filter((p) => p.attempts >= 54).length);
    });
    test('copy: the scatter description and the game strip name the WNBA numbers and pronoun', () => {
        const rows = seasonPlayers(2026);
        const pts = scatterPoints(playerSeasonsFromRows(rows), headshotsFromRows(rows), null, { min: rankMins('wnba', 2026) });
        const d = describeScatter(pts, 'ptsPg', 'efgPct', null, 54);
        expect(d).toMatch(/^\d+ players with 54\+ FGA, /);
        expect(d).not.toContain('Nets');
        expect(describeScatter(pts, 'ptsPg', 'efgPct')).toMatch(/players with 100\+ FGA,.*\. Nets: \.$/); // the NBA's defaults
        const data = { games: [], seasonFgPct: 0.45 };
        expect(describeGames(data, new Set(), 'her')).toContain("each game's FG% against her season FG% of");
        expect(describeGames(data, new Set())).toContain("against his season FG% of");
    });
});

describe('leader bars by game volume (D31)', () => {
    test('the NBA keeps 5 FGA / 3 3PA per game in every season; the WNBA is 4 / 2 in every measured season', () => {
        expect(NBA_LEADER_BARS).toEqual({ fga: 5, fg3a: 3 });
        for (let s = 1997; s <= 2026; s++) {
            expect(BASKETBALL.nba.leaderBars(s), `nba ${s}`).toEqual({ fga: 5, fg3a: 3 });
            expect(BASKETBALL.wnba.leaderBars(s), `wnba ${s}`).toEqual({ fga: 4, fg3a: 2 }); // Step 0's table
        }
        expect(BASKETBALL.wnba.leaderBars(2026)).toEqual({ fga: 4, fg3a: 2 }); // 68.63 / 89.09 FGA per team game = 0.770
    });
    test('2026 boards: a player is eligible at 4n FGA in the window, and the default stays the NBA 5n', () => {
        const players = seasonPlayerGamesFromRows(playerGames2026(), seasonPlayers(2026));
        const w = leaderBoards(players, null, 15, BASKETBALL.wnba.leaderBars(2026));
        const n = leaderBoards(players, null);
        for (const win of [5, 10, 20] as const) {
            expect(w[win].fgPct.rows.every((r) => r.window.attempts >= 4 * win), String(win)).toBe(true);
            expect(w[win].fgPct.eligible, String(win)).toBeGreaterThanOrEqual(n[win].fgPct.eligible);
            expect(w[win].fg3Pct.rows.every((r) => r.window.fg3a >= 2 * win), String(win)).toBe(true);
        }
        expect(w[5].fgPct.eligible).toBeGreaterThan(n[5].fgPct.eligible); // the NBA bar would drop WNBA players
    });
});
