// BB-G5: the team season block behind 'bball-team-season'. The pure steps (split order, the schedule joined to each
// game's rates), the page-side step (the flag gates the read; a failed read keeps the page and is never cached) and the
// template, on real Data API reads (fixtures/README.md: team-season-*.json.gz, the five reads resources/teamSeason.ts makes).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

interface Capture { rates: any[]; strength: any[]; home: any[]; away: any[]; gameRates: any[] }
const capture = (name: string): Capture => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const asReads = (c: Capture) => ({ rates: c.rates, strength: c.strength[0] ?? null, games: [...c.home, ...c.away], gameRates: c.gameRates });
const NBA = capture('team-season-nba-2026'); // Brooklyn Nets 2025-26 (stats id 1610612751, ESPN 17)
const MBB = capture('team-season-mbb-2026'); // Duke 2025-26 (ESPN 150)

const block = vi.hoisted(() => ({ fn: vi.fn() }));
// BB-G12's nearby ranks read the Data API with 'bball-rank-neighbors' on (preview): never from a test
vi.mock('../src/resources/bballNeighbors', async (orig) => ({ ...(await orig<typeof import('../src/resources/bballNeighbors')>()), retrieveTeamRankRows: async () => [], retrievePlayerRankRows: async () => [] }));
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: (...a: unknown[]) => block.fn(...a),
}));
const oracle = JSON.parse(readFileSync(new URL('./fixtures/nba/league_context.json', import.meta.url)).toString());
const shots = JSON.parse(readFileSync(new URL('./fixtures/nba/shots.json', import.meta.url)).toString()) as any[];
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map((s) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result })),
}));

import TeamSeasonBlock from '../src/components/nba/TeamSeasonBlock.astro';
import { NETS_TEAM_ID } from '../src/nba/data/teams';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { FLAGS } from '../src/utils/features';
import { scheduleRows, splitRows } from '../src/utils/teamSeason';
import { ordinal } from '../src/utils/misc';

const NETS_ESPN = 17;
const DUKE = 150;
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { block.fn.mockReset(); block.fn.mockResolvedValue(asReads(NBA)); });

function fakeAstro(locals: Record<string, unknown>, id = String(NETS_TEAM_ID)) {
    const cache: unknown[] = [];
    const headers = new Headers();
    const url = new URL(`https://gameonpaper.com/nba/team/${id}?season=2026`);
    return { astro: { params: { id }, url, locals, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const ok = (r: Awaited<ReturnType<typeof prepareNbaTeam>>) => { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r; };

describe('the captures', () => {
    test('five splits for each team, the producer ranks and percentiles on each', () => {
        for (const c of [NBA, MBB]) {
            expect(splitRows(c.rates).map((r) => r.split)).toEqual(['all', 'home', 'away', 'close', 'clutch']);
            const all = c.rates.find((r) => r.split === 'all');
            expect(all.net_rtg_rank).toBeGreaterThanOrEqual(1);
            expect(all.net_rtg_pct).toBeGreaterThan(0);
            expect(all.net_rtg_pct).toBeLessThan(100);
            expect(c.strength).toHaveLength(1);
        }
    });
});

describe('scheduleRows', () => {
    test('the Nets: every regular-season game once, by date, each final with its score and its own rates', () => {
        const rows = scheduleRows(asReads(NBA).games, NBA.gameRates, NETS_ESPN);
        expect(rows).toHaveLength(new Set([...NBA.home, ...NBA.away].map((g) => String(g.id))).size);
        expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
        expect(rows.filter((r) => r.venue === 'home')).toHaveLength(NBA.home.length);
        const finals = rows.filter((r) => r.completed);
        expect(finals.every((r) => r.teamScore !== null && r.oppScore !== null)).toBe(true);
        // a final the game pages rated carries this team's row: the same game, never the opponent's
        const rated = finals.filter((r) => r.rates);
        expect(rated.length).toBeGreaterThan(0);
        for (const r of rated) expect(String(r.rates!.game_id)).toBe(r.gameId);
    });
    test("the producer's record is the schedule's finals, and every final is rated (NBA 20-62 of 82, Duke 35-3 of 38)", () => {
        for (const [c, espn, games] of [[NBA, NETS_ESPN, 82], [MBB, DUKE, 38]] as const) {
            const finals = scheduleRows(asReads(c).games, c.gameRates, espn).filter((r) => r.completed);
            const st = c.strength[0];
            expect(finals).toHaveLength(games);
            expect(c.rates.find((r) => r.split === 'all').games).toBe(games);
            expect(finals.filter((r) => r.teamScore! > r.oppScore!).length).toBe(st.wins);
            expect(finals.filter((r) => r.teamScore! < r.oppScore!).length).toBe(st.losses);
            expect(finals.every((r) => r.rates !== null)).toBe(true);
        }
        // Duke's 12 neutral-site games are in neither the home nor the away split
        const duke = scheduleRows(asReads(MBB).games, MBB.gameRates, DUKE);
        const split = (k: string) => MBB.rates.find((r) => r.split === k).games;
        expect(duke.filter((r) => r.venue === 'home')).toHaveLength(split('home'));
        expect(duke.filter((r) => r.venue === 'away')).toHaveLength(split('away'));
    });
    test('a game listed by both reads is kept once; the opponent is the other side', () => {
        const g = NBA.home[0];
        const rows = scheduleRows([g, g], [], NETS_ESPN);
        expect(rows).toHaveLength(1);
        expect(rows[0].oppId).toBe(Number(g.away_id));
        expect(rows[0].venue).toBe(g.neutral_site === true || g.neutral_site === 'true' ? 'neutral' : 'home');
    });
});

describe('prepareNbaTeam with the flag', () => {
    test("'bball-team-season' is a preview flag", () => { expect(FLAGS['bball-team-season']).toBe('preview'); });
    test('off (no preview): no read, no seasonBlock key, so the page is byte for byte today\'s', async () => {
        const r = ok(await prepareNbaTeam(fakeAstro({}).astro));
        expect(block.fn).not.toHaveBeenCalled();
        expect('seasonBlock' in r).toBe(false);
    });
    test('on: one read keyed by the stats id (season tables) and the ESPN id (games), the page cached as before', async () => {
        const { astro, cache } = fakeAstro({ preview: true });
        const r = ok(await prepareNbaTeam(astro));
        expect(block.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, NETS_ESPN);
        expect(r.seasonBlock).toEqual(asReads(NBA));
        expect(cache).toHaveLength(1);
        expect(cache[0]).not.toBe(false);
    });
    test('on, a 404 (a team_id the season does not name) spends no read', async () => {
        expect(await prepareNbaTeam(fakeAstro({ preview: true }, '1').astro)).toEqual({ notFound: true });
        expect(block.fn).not.toHaveBeenCalled();
    });
    test('on, a failed read: the page renders, the block is null, nothing is cached', async () => {
        block.fn.mockRejectedValueOnce(new Error('down'));
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = ok(await prepareNbaTeam(astro));
        expect(r.seasonBlock).toBeNull();
        expect(r.dashboard).not.toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const render = (data: unknown, league: string, espnId: number, season = 2026) =>
    container.renderToString(TeamSeasonBlock, { props: { data, season, espnId, teamName: 'Team' }, locals: { league } as App.Locals });

describe('TeamSeasonBlock', () => {
    test('the Nets: the producer record, the rates table with its ranks, five splits, the schedule', async () => {
        const html = await render(asReads(NBA), 'nba', NETS_ESPN);
        const st = NBA.strength[0];
        const all = NBA.rates.find((r) => r.split === 'all');
        expect(html).toContain(`${st.wins}-${st.losses}`);
        expect(html).toContain(all.off_rtg.toFixed(1));
        expect(html).toContain('id="season-rates"');
        expect(html.split('id="season-splits"')[1].split('</table>')[0].match(/<tr/g)).toHaveLength(6); // header + 5
        const games = scheduleRows(asReads(NBA).games, NBA.gameRates, NETS_ESPN);
        expect(html.split('id="season-schedule"')[1].split('</table>')[0].match(/<tr/g)).toHaveLength(games.length + 1);
        expect(html).toContain('href="/nba/game/');
        expect(html).not.toContain('Adj. EM'); // college only
        expect(html).toMatch(/hulk-bg-level-\d/);
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test("a late tip is dated on the scoreboard's day (America/New_York), not UTC's", async () => {
        const html = await render(asReads(NBA), 'nba', NETS_ESPN);
        const late = [...NBA.home, ...NBA.away].find((g) => Number(String(g.date).slice(11, 13)) < 4); // a 10 pm ET tip is 02:00Z or 03:00Z
        expect(late).toBeDefined();
        const row = html.split(`/nba/game/${late.id}"`)[0].split('<tr').at(-1)!;
        const et = new Date(new Date(late.date).getTime() - 5 * 3600 * 1000); // before 04:00Z is the prior day in both EST and EDT
        expect(row).toContain(`>${et.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}<`);
        expect(row).not.toContain(`>${new Date(late.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}<`);
    });
    test('Duke: college adds adjusted EM and tempo from team_strength', async () => {
        const html = await render(asReads(MBB), 'mbb', DUKE);
        const st = MBB.strength[0];
        expect(html).toContain('Adj. EM');
        expect(html).toContain('Tempo');
        expect(html).toContain(Math.abs(st.adj_net_rtg).toFixed(1));
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('an unshaded value (Pace, the season line) still prints its rank and the producer percentile, without colour', async () => {
        const html = await render(asReads(NBA), 'nba', NETS_ESPN);
        const all = NBA.rates.find((r) => r.split === 'all');
        const tag = (r: number, p: number) => `(#${r}, ${ordinal(Math.round(p))} pctl)`;
        const line = html.split('id="season-line"')[1].split('</p>')[0];
        expect(line).toContain(tag(all.pace_rank, all.pace_pct));
        expect(line).toContain(tag(all.net_rtg_rank, all.net_rtg_pct));
        const splits = html.split('id="season-splits"')[1].split('</table>')[0];
        for (const r of NBA.rates) {
            const cell = splits.split(tag(r.pace_rank, r.pace_pct))[0].split('<td').at(-1)!;
            expect(cell).not.toMatch(/hulk-bg-level/); // Pace stays unshaded
        }
        const mbb = await render(asReads(MBB), 'mbb', DUKE);
        const st = MBB.strength[0];
        expect(mbb.split('id="season-adjusted"')[1]).toContain(tag(st.adj_net_rtg_rank, st.adj_net_rtg_pct));
        // no producer percentile: the rank alone
        const noPct = { ...asReads(NBA), rates: NBA.rates.map((r) => ({ ...r, pace_pct: null })) };
        expect((await render(noPct, 'nba', NETS_ESPN)).split('id="season-line"')[1].split('</p>')[0]).toContain(`Pace ${all.pace.toFixed(1)} <span class="text-muted">(#${all.pace_rank})</span>`);
    });
    test('a failed read says unavailable; a team with no rated split says so', async () => {
        expect(await render(null, 'nba', NETS_ESPN)).toContain('id="season-unavailable"');
        expect(await render({ rates: [], strength: null, games: [], gameRates: [] }, 'nba', NETS_ESPN)).toContain('id="season-empty"');
    });
});
