// 'bball-share-card', G-R5: the basketball player and team pages' link previews (basketball/statCard.ts), drawn by the API
// (python/share_card.py render_basketball_stats) at /<league>/players|team/<id>/card.png (routes/basketball/statCard.ts).
// The rows are real Data API rows read 2026-11-18: Luka Dončić's 2026-27 shot_season_players row and the Nets' 2026-27
// team_strength row. The pages' heads are checked in test/nba/byteIdentity.render.test.ts.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { playerCardBody, playerRow, rankText, statShareImage, teamCardBody } from '../../src/basketball/statCard';
import type { SeasonPlayerRow } from '../../src/resources/nbaShots';
import type { TeamStrengthRow } from '../../src/resources/teamSeason';

const LUKA: SeasonPlayerRow = {
    season: 2027, person_id: 1629029, player_name: 'Luka Dončić', team_id: 1610612747, team_tricode: 'LAL', attempts: 296, makes: 144,
    fg3a: 160, fg3m: 65, ra_attempts: 25, ra_makes: 20, mid_attempts: 63, mid_makes: 33, is_primary: true, n_teams: 1, has_stats: true,
    gp: 12, min_pg: 35.9, fga_total: 296.0, fg_pct: 0.486, efg_pct: 0.596, ts_pct: 0.66, usg_pct: 0.392, pie: 0.217, pts_pg: 39.0,
    fga_pg: 24.7, min_total: 430.97, headshot_href: 'https://a.espncdn.com/i/headshots/nba/players/full/3945274.png', fg3_pct: 0.40625,
    ft_pct: 0.8646616541353384, fg_pct_n: 296, efg_pct_n: 296, fg3_pct_n: 160, ft_pct_n: 133, fg_pct_rank: null, fg_pct_pct: null,
    efg_pct_rank: null, efg_pct_pct: null, fg3_pct_rank: 4.0, fg3_pct_pct: 71.42857142857143, ft_pct_rank: 5.0, ft_pct_pct: 54.54545454545455,
};
const NETS: TeamStrengthRow = {
    wins: 3, losses: 10, adj_off_rtg: 113.35025533922237, adj_def_rtg: 116.06798843726395, adj_net_rtg: -2.7177330980415757,
    adj_off_rtg_rank: 19.0, adj_def_rtg_rank: 25.0, adj_net_rtg_rank: 23.0, adj_off_rtg_pct: null, adj_def_rtg_pct: null, adj_net_rtg_pct: null,
    sos: -0.08951848820880424, sos_rank: 16.0, sos_pct: null, sos_n: 13, sov: -3.2828083427276655, sov_rank: 27.0, sov_pct: null, sov_n: 3,
};
const NETS_TEAM = { team_id: 1610612751, tricode: 'BKN', name: 'Brooklyn Nets' };

describe('the card bodies: producer columns, formatted only', () => {
    test("a player's card: his primary row, the producer's ranks where it has them", () => {
        const body = playerCardBody(LUKA, 'nba', 2027);
        expect(body.title).toBe('Luka Dončić');
        expect(body.stamp).toBe('NBA / 2026-27 regular season');
        expect(body.subtitle).toBe('LAL / 12 GP / 35.9 MIN');
        expect(body.team.logo).toBe('https://a.espncdn.com/i/teamlogos/nba/500/13.png');
        expect(body.tiles).toEqual([
            { value: '39.0', label: 'Points per game', rank: null },
            { value: '66.0%', label: 'TS%', rank: null },
            // efg_pct_rank is null in the producer's row: no rank, never one the site works out
            { value: '59.6%', label: 'eFG%', rank: null },
            { value: '40.6%', label: '3P%', rank: '#4, 71st pctl' },
        ]);
    });
    test("a team's card: record and team_strength's adjusted ratings with their ranks", () => {
        const body = teamCardBody(NETS, 'nba', 2027, NETS_TEAM);
        expect(body.title).toBe('Brooklyn Nets');
        expect(body.subtitle).toBe('BKN / 3-10');
        expect(body.tiles.map((t) => [t.label, t.value, t.rank])).toEqual([
            ['Adj. net rating', '-2.7', '#23'],
            ['Adj. offense', '113.4', '#19'],
            ['Adj. defense', '116.1', '#25'],
            ['Strength of schedule', '-0.1', '#16'],
        ]);
    });
    test("ranks read as the team page's: ties are T-, a percentile is suffixed", () => {
        expect(rankText(4.5, null)).toBe('#T-4');
        expect(rankText(1, 99.4)).toBe('#1, 99th pctl');
        expect(rankText(null, 50)).toBeNull();
    });
    test('a traded player draws his primary row', () => {
        const other = { ...LUKA, team_id: 1610612742, team_tricode: 'DAL', is_primary: false };
        expect(playerRow([other, LUKA], LUKA.person_id)?.team_tricode).toBe('LAL');
        expect(playerRow([other], LUKA.person_id)?.team_tricode).toBe('DAL');
        expect(playerRow([LUKA], 1)).toBeUndefined();
    });
    test('the og:image URL names the season and the day', () => {
        const img = statShareImage('team', 'mbb', 2509, 2027, 'Purdue', Date.parse('2026-11-18T12:00:00Z'));
        expect(img.url).toBe('https://gameonpaper.com/mbb/team/2509/card.png?season=2027&v=2026-11-18');
        expect(img.alt).toBe('Purdue, 2026-27: record and adjusted ratings, with league ranks');
    });
});

const up = vi.hoisted(() => ({ fetched: [] as { url: string; body: any }[], cardStatus: 200, players: vi.fn(), strength: vi.fn() }));
vi.mock('../../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: any) => {
        up.fetched.push({ url: String(url), body: JSON.parse(init?.body ?? 'null') });
        if (String(url).includes('/card.png')) return new Response(up.cardStatus === 200 ? new Uint8Array([0x89, 0x50]) : 'no', { status: up.cardStatus });
        throw new Error(`unexpected fetch in test: ${url}`);
    },
}));
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: (...a: unknown[]) => up.players(...a),
}));
vi.mock('../../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/teamSeason')>()),
    retrieveTeamStrength: (...a: unknown[]) => up.strength(...a),
}));

describe('the card route', async () => {
    const { basketballStatCardRoute, STAT_CARD_MAX_AGE } = await import('../../src/routes/basketball/statCard');
    const call = (league: any, kind: any, id: string, query = '') => {
        const cache = { set: vi.fn() };
        const res = basketballStatCardRoute(league, kind)({ params: { id }, url: new URL(`https://gameonpaper.com/${league}/${kind}/${id}/card.png${query}`), cache } as any) as Promise<Response>;
        return { res, cache };
    };
    beforeEach(() => { up.fetched = []; up.cardStatus = 200; up.players.mockReset(); up.strength.mockReset(); });

    test("a player's card: the page's season read, the body POSTed to the API, held six hours", async () => {
        up.players.mockResolvedValue([LUKA]);
        const { res, cache } = call('nba', 'players', '1629029', '?season=2027&v=2026-11-18');
        const r = await res;
        expect(r.status).toBe(200);
        expect(r.headers.get('Content-Type')).toBe('image/png');
        expect(r.headers.get('Cache-Control')).toBe(`public, max-age=${STAT_CARD_MAX_AGE}`);
        expect(cache.set).toHaveBeenCalledWith({ maxAge: STAT_CARD_MAX_AGE, tags: ['nba', 'share-card'] });
        expect(up.players).toHaveBeenCalledWith(2027, 'nba');
        expect(up.fetched).toHaveLength(1);
        expect(up.fetched[0].url).toMatch(/\/nba\/players\/1629029\/card\.png$/);
        expect(up.fetched[0].body).toEqual(playerCardBody(LUKA, 'nba', 2027));
    });
    test("a team's card reads team_strength for the team the season knows", async () => {
        up.players.mockResolvedValue([]);
        up.strength.mockResolvedValue(NETS);
        const r = await call('nba', 'team', '1610612751', '?season=2027').res;
        expect(r.status).toBe(200);
        expect(up.strength).toHaveBeenCalledWith('nba', 2027, 1610612751);
        expect(up.fetched[0].body.title).toBe('Brooklyn Nets');
    });
    test("a team only the season's rows name gets a card, as its page does (teamsFromSeasonRows)", async () => {
        up.players.mockResolvedValue([{ ...LUKA, team_id: 42, team_tricode: 'XYZ' }]);
        up.strength.mockResolvedValue(NETS);
        const r = await call('nba', 'team', '42', '?season=2027').res;
        expect(r.status).toBe(200);
        expect(up.fetched[0].body.title).toBe('XYZ');
    });
    test('no row is a 404, no card drawn', async () => {
        up.players.mockResolvedValue([]);
        up.strength.mockResolvedValue(null);
        expect((await call('nba', 'players', '1', '?season=2027').res).status).toBe(404);
        expect((await call('nba', 'team', '1610612751', '?season=2027').res).status).toBe(404);
        up.strength.mockResolvedValue(NETS);
        expect((await call('nba', 'team', '42', '?season=2027').res).status).toBe(404); // neither the rows nor the module know it
        expect(up.fetched).toHaveLength(0);
    });
    test('a failed read or draw is a 502 that is never kept; a malformed id a 400', async () => {
        up.players.mockRejectedValue(new Error('Data API down'));
        const failed = call('nba', 'players', '1629029');
        expect((await failed.res).status).toBe(502);
        expect((await failed.res).headers.get('Cache-Control')).toBe('no-store');
        up.players.mockResolvedValue([LUKA]);
        up.cardStatus = 500;
        expect((await call('nba', 'players', '1629029', '?season=2027').res).status).toBe(502);
        expect((await call('nba', 'players', 'abc').res).status).toBe(400);
    });
});
