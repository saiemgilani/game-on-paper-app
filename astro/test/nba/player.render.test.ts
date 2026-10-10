// test/nba/player.render.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { text } from '../helpers/tables';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const players = read('season_players');
const shots = read('shots');
const playerGames = read('player_games');
const oracle = read('league_context');
const PID = Number(Object.keys(playerGames)[0]);
const me = players.find((p: any) => p.person_id === PID);
const state = { nullDates: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveSeasonPlayerRows: async () => players.map((p: any) => ({
        season: 2026, person_id: p.person_id, player_name: p.player_name, team_id: p.team_id, team_tricode: p.team_tricode,
        attempts: p.attempts, makes: p.makes, fg3a: p.fg3a, fg3m: p.fg3m, ra_attempts: 0, ra_makes: 0, mid_attempts: 0, mid_makes: 0,
        is_primary: true, n_teams: 1, has_stats: false, gp: null, min_pg: null, fga_total: null, fg_pct: null, efg_pct: null, ts_pct: null,
        usg_pct: null, pie: null, pts_pg: null, fga_pg: null, min_total: null, headshot_href: null,
    })),
    retrievePlayerShots: async (_s: number, id: number) => shots.filter((s: any) => s.person_id === id),
    retrievePlayerGameRows: async () => playerGames[PID].map((g: any) => ({
        season: 2026, person_id: PID, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: state.nullDates ? null : g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    })),
    retrievePlayerSeasons: async () => [2025, 2026],
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function render(id: string, season = '') {
    const { default: Page } = await import('../../src/pages/nba/players/[id].astro');
    return container.renderToString(Page, { params: { id }, request: new Request(`https://gameonpaper.com/nba/players/${id}${season}`), locals: { preview: true } as App.Locals });
}

describe('/nba/players/[id]', () => {
    test('renders the header line, the ranks, the explorer island and the season picker', async () => {
        const html = await render(String(PID));
        const mine = shots.filter((s: any) => s.person_id === PID);
        const makes = mine.filter((s: any) => s.shot_result === 'Made').length;
        expect(text(html.split('id="nba-line"')[1].split('</p>')[0])).toContain(`${makes}/${mine.length} FG`);
        expect(html).toContain(me.player_name);
        expect(html).toContain('id="ranks"');
        expect(html).toContain('id="nba-games-panel"');
        expect(html).toContain('id="nba-hex-panel"');
        expect(html).toContain('2024-25');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('null game dates: the six charts render and the per-game views say unavailable', async () => {
        state.nullDates = true;
        const html = await render(String(PID));
        state.nullDates = false;
        expect(html).toContain('Game-by-game views are unavailable');
        expect(html).toContain('id="nba-hex-panel"');
        expect(html).not.toContain('id="nba-games-panel"');
    });
});
