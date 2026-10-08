import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { aggregateGames, opponentAverages, opponentBars } from '../src/utils/gameSet';

// The Data API's real 2025 bodies (fixtures/team-opponent-splits-2025.json):
// team_opponent_splits by team_id and by opponent_id, and the schedule rows,
// for Alabama (cfb 333) and Kansas City (nfl 12).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/team-opponent-splits-2025.json', import.meta.url)).toString());
// the Data API, for retrieveTeamOpponentSplits: team 333 answers both reads; 9001's
// opponent read is a 500 and 9002's a 200 with no data array
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const u = new URL(String(url));
        if (!u.pathname.endsWith('/team_opponent_splits')) return new Response('not found', { status: 404 });
        const id = u.searchParams.get('team_id') ?? u.searchParams.get('opponent_id');
        const side = u.searchParams.has('team_id') ? 'team_id' : 'opponent_id';
        if (id === '9001' && side === 'opponent_id') return new Response('boom', { status: 500 });
        if (id === '9002' && side === 'opponent_id') return new Response('{"error":"bad"}', { status: 200 });
        if (id !== '333') return new Response('{"data":[]}', { status: 200 });
        return new Response(JSON.stringify(fixture.cfb[side]), { status: 200 });
    },
}));

const load = (league: 'cfb' | 'nfl') => {
    const f = fixture[league];
    return {
        splits: { team: f.team_id.data, opponent: f.opponent_id.data },
        events: [...f.schedule.home_id.data, ...f.schedule.away_id.data],
    };
};

describe('opponentBars', () => {
    test('cfb: one bar per game, in kickoff order, labelled at/vs the opponent abbreviation', () => {
        const { splits, events } = load('cfb');
        const bars = opponentBars(splits, events, 'epa_per_play');
        expect(bars.length).toBe(splits.team.length);
        // Georgia is on the meme list, so it prints lowercase; the SEC title game and
        // the Rose Bowl were neutral (vs), the CFP first round was at Oklahoma
        expect(bars.map((b) => b.label)).toEqual([
            'at FSU', 'vs ULM', 'vs WIS', 'at uga', 'vs VAN', 'at MIZ', 'vs TENN', 'at SC',
            'vs LSU', 'vs OU', 'vs EIU', 'at AUB', 'vs uga', 'at OU', 'vs IU',
        ]);
        expect(bars[0].title).toBe('at Florida State (L 17-31)');
        expect(bars[1].title).toBe('vs UL Monroe (W 73-0)');
    });

    test('raw is the team\'s own value; margin subtracts the opponent\'s in the same game', () => {
        const { splits, events } = load('cfb');
        for (const metric of ['epa_per_play', 'success_rate'] as const) {
            const bars = opponentBars(splits, events, metric);
            // Florida State, week 1: Alabama -0.01 EPA/play, FSU 0.20 against it
            const fsuTeam = splits.team.find((r: any) => r.game_id === 401752665);
            const fsuOpp = splits.opponent.find((r: any) => r.game_id === 401752665);
            expect(bars[0].raw).toBe(fsuTeam[metric]);
            expect(bars[0].margin).toBeCloseTo(fsuTeam[metric] - fsuOpp[metric], 12);
        }
        expect(opponentBars(splits, events, 'epa_per_play')[0].margin).toBeCloseTo(-0.21, 12);
    });

    test('nfl: abbreviations and names come from the schedule; F7 carries no name', () => {
        const { splits, events } = load('nfl');
        const bars = opponentBars(splits, events, 'success_rate');
        expect(bars.length).toBe(17);
        // week 1 in Sao Paulo was a neutral-site "home" game for the Chargers
        expect(bars.slice(0, 4).map((b) => b.label)).toEqual(['vs LAC', 'vs PHI', 'at NYG', 'vs BAL']);
        expect(bars[0].title).toBe('vs Los Angeles Chargers (L 21-27)');
        expect(bars[16].label).toBe('at LV');
    });

    test('without schedule rows: ordered by season type then week, labelled by the F7 name', () => {
        const { splits } = load('cfb');
        const bars = opponentBars(splits, [], 'epa_per_play');
        expect(bars.length).toBe(15);
        expect(bars[0].label).toBe('at Florida State Seminoles');
        expect(bars[12].label).toBe('vs georgia bulldogs');
        // both postseason games are week 1; the regular season comes first
        expect(bars.slice(13).map((b) => b.label).sort()).toEqual(['at Indiana Hoosiers', 'at Oklahoma Sooners']);
    });

    test('a rescheduled game sits at its kickoff, not its week', () => {
        const { splits, events } = load('nfl');
        // move Kansas City's week-7 Raiders game to between weeks 1 and 2
        const moved = events.map((e: any) => (e.game_id === 401772753 ? { ...e, start_date: '2025-09-10T17:00:00.000Z' } : e));
        const labels = opponentBars(splits, moved, 'epa_per_play').map((b) => b.label);
        expect(labels.slice(0, 3)).toEqual(['vs LAC', 'vs LV', 'vs PHI']);
        expect(labels.length).toBe(17);
    });

    test('a game missing from the schedule: the whole list falls back to week order', () => {
        const { splits, events } = load('nfl');
        const partial = events.filter((e: any) => e.game_id !== 401772753);
        const bars = opponentBars(splits, partial, 'epa_per_play');
        // week 7, sixth in week order (weeks 1-6 before it), labelled from F7
        expect(bars[6].label).toBe('vs 13');
        expect(bars.map((b) => b.label).slice(0, 2)).toEqual(['vs LAC', 'vs PHI']);
    });

    test('a game with no opponent row keeps its raw bar and has no margin', () => {
        const { splits, events } = load('nfl');
        const opponent = splits.opponent.filter((r: any) => r.game_id !== 401772714);
        const bars = opponentBars({ team: splits.team, opponent }, events, 'epa_per_play');
        expect(bars[0].raw).toBe(splits.team.find((r: any) => r.game_id === 401772714).epa_per_play);
        expect(bars[0].margin).toBeNull();
    });
});

describe('aggregateGames / opponentAverages', () => {
    test('the season average is play-weighted, not the mean of the bars', () => {
        for (const league of ['cfb', 'nfl'] as const) {
            const { splits, events } = load(league);
            for (const metric of ['epa_per_play', 'success_rate'] as const) {
                const plays = splits.team.reduce((s: number, r: any) => s + r.plays, 0);
                const weighted = splits.team.reduce((s: number, r: any) => s + r[metric] * r.plays, 0) / plays;
                expect(aggregateGames(splits.team)[metric], `${league} ${metric}`).toBeCloseTo(weighted, 12);
                const bars = opponentBars(splits, events, metric);
                const barMean = bars.reduce((s, b) => s + (b.raw as number), 0) / bars.length;
                expect(Math.abs(barMean - weighted), `${league} ${metric}`).toBeGreaterThan(1e-6);
            }
        }
    });

    test('the margin average is offense minus defense, each play-weighted, for both metrics', () => {
        // spelled out here rather than through aggregateGames, so a helper that
        // ignores its metric cannot agree with itself
        const weighted = (rows: any[], metric: string) =>
            rows.reduce((s, r) => s + r[metric] * r.plays, 0) / rows.reduce((s, r) => s + r.plays, 0);
        for (const league of ['cfb', 'nfl'] as const) {
            const { splits } = load(league);
            for (const metric of ['epa_per_play', 'success_rate'] as const) {
                const avg = opponentAverages(splits, metric);
                const off = weighted(splits.team, metric), def = weighted(splits.opponent, metric);
                expect(avg.raw, `${league} ${metric}`).toBeCloseTo(off, 12);
                expect(avg.margin, `${league} ${metric}`).toBeCloseTo(off - def, 12);
            }
        }
        // Kansas City 2025: 468 successes on 1,045 plays across the fixture's 17 rows
        expect(opponentAverages(load('nfl').splits, 'success_rate').raw).toBeCloseTo(0.4478, 4);
    });

    test('a game missing either side drops out of the margin average only', () => {
        const { splits } = load('nfl');
        const opponent = splits.opponent.filter((r: any) => r.game_id !== 401772714);
        const team = splits.team.filter((r: any) => r.game_id !== 401772714);
        const avg = opponentAverages({ team: splits.team, opponent }, 'epa_per_play');
        expect(avg.raw).toBeCloseTo(aggregateGames(splits.team).epa_per_play as number, 12);
        expect(avg.margin).toBeCloseTo((aggregateGames(team).epa_per_play as number) - (aggregateGames(opponent).epa_per_play as number), 12);
    });

    test('nulls and zero-play rows carry no weight; no rows is null, not NaN', () => {
        const row = { game_id: 1, plays: 10, epa_per_play: 0.5, success_rate: null };
        const out = aggregateGames([row, { ...row, game_id: 2, plays: 0, epa_per_play: 9 }] as any);
        expect(out).toEqual({ games: 2, plays: 10, epa_per_play: 0.5, success_rate: null });
        expect(aggregateGames([])).toEqual({ games: 0, plays: 0, epa_per_play: null, success_rate: null });
    });
});

describe('retrieveTeamOpponentSplits', () => {
    test('both reads: the team\'s rows and its opponents\' rows against it', async () => {
        const { retrieveTeamOpponentSplits } = await import('../src/resources/sdv');
        const out = await retrieveTeamOpponentSplits(2025, 333);
        expect(out).toEqual({ team: fixture.cfb.team_id.data, opponent: fixture.cfb.opponent_id.data });
    });

    test('either read failing is null, never a half-empty pair', async () => {
        const { retrieveTeamOpponentSplits } = await import('../src/resources/sdv');
        expect(await retrieveTeamOpponentSplits(2025, 9001)).toBeNull();
        expect(await retrieveTeamOpponentSplits(2025, 9002)).toBeNull();
    });
});
