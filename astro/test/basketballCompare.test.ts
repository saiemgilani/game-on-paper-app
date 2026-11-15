// BB-G13: basketball player compare behind 'bball-compare', football's compare page (#359) over the basketball player
// page's reads. The pure rows (every card the same rows; ranks and shading only where the producer ships them), the
// page-side step (the flag, the one season read, the per-player Impact and Value reads, the add control's team and roster,
// the cache decision), the pages and the player page's Compare button (off: byte for byte the page without it). On real
// Data API reads (fixtures/README.md: player-compare.json.gz, player-impact.json.gz, player-war.json.gz). Every read is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// A live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth against the Data API from
// this IP (429 lockout): fetch throws, and any attempt fails the file.
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const PC = gz('player-compare') as Record<'nbaImpact' | 'nbaWar' | 'nbaSeasonPlayers' | 'nbaMultiTeam' | 'mbbSeasonPlayers', any[]>;
const PI = gz('player-impact') as Record<'mbbTeam', any[]>;
const PW = gz('player-war') as Record<'mbbTeam', any[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const MPJ = 1629008;
const CLOWNEY = 1641730;
const SWAIN = 4848625; // Texas 2025-26
const MARK = 4432243;
const HARDEN = 201935; // two NBA teams in 2025-26 (nbaMultiTeam)
const HEIDE = 5105855; // Texas: 3P% ranked, FG% and FT% under the attempt minimums

const byId = (rows: any[], id: number) => rows.filter((r) => Number(r.player_id) === id);
const reads = vi.hoisted(() => ({ season: vi.fn(), impact: vi.fn(), war: vi.fn(), seasons: vi.fn() }));
const feed = { seasonRows: (league: string) => (league === 'mbb' ? PC.mbbSeasonPlayers : PC.nbaSeasonPlayers) };
beforeEach(() => {
    for (const m of Object.values(reads)) m.mockReset();
    reads.season.mockImplementation(async (_s: number, league: string) => feed.seasonRows(league));
    reads.impact.mockImplementation(async (league: string, _s: number, id: number) => byId(league === 'mbb' ? PI.mbbTeam : PC.nbaImpact, id));
    reads.war.mockImplementation(async (league: string, _s: number, id: number) => byId(league === 'mbb' ? PW.mbbTeam : PC.nbaWar, id));
    reads.seasons.mockResolvedValue([2025, 2026]);
});

// the player page's own reads, for the Compare button tests (playerWar.test.ts's mocks)
const oracle = fx('nba/league_context');
const shots = fx('nba/shots') as any[];
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: (...a: unknown[]) => reads.season(...a),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrievePlayerShots: async (_s: number, id: number) => shots.filter((s) => s.person_id === id).map(lite),
    retrievePlayerGameRows: async () => [],
    retrievePlayerSeasons: (...a: unknown[]) => reads.seasons(...a),
    retrieveCoverageRows: async () => [],
}));
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: (...a: unknown[]) => reads.impact(...a) }));
vi.mock('../src/resources/playerWar', async (orig) => ({
    ...(await orig<typeof import('../src/resources/playerWar')>()),
    retrievePlayerWar: (...a: unknown[]) => reads.war(...a),
    retrievePlayerEpv: async () => [],
}));
vi.mock('../src/resources/shotQuality', () => ({ retrieveGameShotQuality: async () => [], retrieveTeamShotQuality: async () => [], retrievePlayerShotQuality: async () => [] }));

import { prepareBasketballCompare } from '../src/routes/basketball/compare';
import { impactRows, shootingRows, valueRows } from '../src/utils/basketballCompare';
import { FLAGS } from '../src/utils/features';
import { generateColorRampValue } from '../src/utils/misc';
import { playerSeasonsFromRows } from '../src/nba/adapters';

const LEAGUES = ['nba', 'wnba', 'mbb', 'wbb'] as const;
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false };
const on = (extra: Record<string, boolean> = {}) => ({ preview: true, flagOverrides: { ...OFF, ...extra } });
const astroAt = (path: string, locals: Record<string, unknown>) => {
    const set = vi.fn();
    const astro: any = { locals, url: new URL(`https://gameonpaper.com${path}`), params: {}, response: { headers: new Headers() }, cache: { set } };
    return { astro, set };
};
const prep = (league: (typeof LEAGUES)[number], query: string, locals: Record<string, unknown> = on()) => {
    const { astro, set } = astroAt(`/${league}/players/compare${query}`, locals);
    return prepareBasketballCompare(astro, league).then((r) => ({ r, set, astro }));
};

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = async (league: (typeof LEAGUES)[number], query: string, locals: Record<string, unknown> = on()) => {
    const { default: Page } = await import(/* @vite-ignore */ `../src/pages/${league}/players/compare.astro`);
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/${league}/players/compare${query}`), locals: locals as unknown as App.Locals });
};
const card = (page: string, id: number) => page.split(`data-compare-card="${id}"`)[1]?.split('data-compare-card=')[0] ?? '';
/** A card's cells for a section, each [label, class, text]. */
const cells = (c: string, section: string) => [...(c.split(`data-compare-category="${section}"`)[1] ?? '').split('</table>')[0]
    .matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => [m[1].replace(/<[^>]*>/g, '').trim(), m[2], m[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()]);

describe('the rows (pure)', () => {
    const [mpjWar] = byId(PC.nbaWar, MPJ);
    test('Value: WAR with its producer rank and percentile, its 90% interval on the next row, VORP, the rating', () => {
        const rows = valueRows([mpjWar]);
        expect(rows.map((r) => r.key)).toEqual(['war', 'war_interval', 'vorp', 'rating']);
        expect(rows[0]).toMatchObject({ text: mpjWar.war.toFixed(1), rank: mpjWar.war_rank, pct: mpjWar.war_pct });
        expect(mpjWar.war_rank).toBe(46); // the producer's, as served on 2026-11-08
        expect(rows[1].text).toBe(`${mpjWar.war_lo.toFixed(1)} to ${mpjWar.war_hi.toFixed(1)}`);
        expect(rows[2]).toMatchObject({ rank: mpjWar.vorp_rank, pct: mpjWar.vorp_pct });
        expect(rows[3]).toMatchObject({ rank: null, pct: null });
    });
    test('a player with no row, or a failed read, gets the same rows as dashes', () => {
        for (const none of [[], null]) {
            const rows = valueRows(none);
            expect(rows.map((r) => r.key)).toEqual(valueRows([mpjWar]).map((r) => r.key));
            expect(rows.every((r) => r.text === '—' && r.rank === null && r.pct === null)).toBe(true);
            expect(impactRows(none, false, true).map((r) => r.key)).toEqual(impactRows(byId(PC.nbaImpact, MPJ), false, true).map((r) => r.key));
        }
    });
    test("Impact: player_impact ships no ranks yet, so no rank and no shade; 'bball-war' on names its WAR \"Impact WAR\"", () => {
        const rows = impactRows(byId(PC.nbaImpact, MPJ), false, false);
        expect(rows.every((r) => r.rank === null && r.pct === null)).toBe(true);
        expect(rows.find((r) => r.key === 'rapm')!.text).toBe(`+${byId(PC.nbaImpact, MPJ)[0].rapm.toFixed(1)}`);
        expect(rows.some((r) => r.key === 'war')).toBe(true);
        expect(rows.find((r) => r.key === 'war')!.label).toBe('WAR');
        const relabelled = impactRows(byId(PC.nbaImpact, MPJ), false, true).find((r) => r.key === 'war')!;
        expect([relabelled.label, relabelled.text]).toEqual(['Impact WAR', rows.find((r) => r.key === 'war')!.text]);
        // college: player_value's box BPM, net then offense and defense
        expect(impactRows(byId(PI.mbbTeam, SWAIN), true, true).map((r) => r.key)).toEqual(['box_bpm', 'box_obpm', 'box_dbpm']);
    });
    test("Shooting (Q46): shot_season_players' FG%, eFG%, 3P% and FT% with the producer's rank and percentile", () => {
        const [row] = PC.nbaSeasonPlayers.filter((r) => r.person_id === MPJ);
        const p = playerSeasonsFromRows(PC.nbaSeasonPlayers).find((x) => x.person_id === MPJ)!;
        const rows = shootingRows(p, row);
        expect(rows.map((r) => r.key)).toEqual(['fg', 'fg_pct', 'efg_pct', 'fg3_pct', 'fg3', 'ft_pct', 'gp', 'min', 'usg_pct', 'ts_pct']);
        expect(rows.find((r) => r.key === 'fg')!.text).toBe(`${p.makes}/${p.attempts}`);
        for (const m of ['fg_pct', 'efg_pct', 'fg3_pct', 'ft_pct']) {
            // the table's own value (never makes / attempts), its rank and percentile as served
            expect(rows.find((r) => r.key === m)).toMatchObject({ text: `${(row[m] * 100).toFixed(1)}%`, rank: row[`${m}_rank`], pct: row[`${m}_pct`] });
        }
        expect([row.fg_pct_rank, row.ft_pct_rank]).toEqual([138, 40]); // as served on 2026-11-13
        expect(rows.filter((r) => ['fg', 'fg3', 'gp', 'min', 'usg_pct', 'ts_pct'].includes(r.key)).every((r) => r.rank === null && r.pct === null)).toBe(true);
    });
    test('Shooting: under the attempt minimum the value with no rank or shading; no row is dashes', () => {
        const row = PC.mbbSeasonPlayers.find((r) => r.person_id === HEIDE);
        const rows = shootingRows(playerSeasonsFromRows(PC.mbbSeasonPlayers).find((x) => x.person_id === HEIDE)!, row);
        expect(rows.find((r) => r.key === 'fg_pct')).toMatchObject({ text: `${(row.fg_pct * 100).toFixed(1)}%`, rank: null, pct: null });
        expect(rows.find((r) => r.key === 'ft_pct')).toMatchObject({ rank: null, pct: null });
        expect(rows.find((r) => r.key === 'fg3_pct')!.rank).toBe(27.5); // a tie, fractional as served
        expect(shootingRows(null, null).every((r) => r.text === '—' && r.rank === null)).toBe(true);
    });
});

describe('the page-side step', () => {
    test("the flag is preview, and off every league's page is the 404 with no read", async () => {
        expect(FLAGS['bball-compare']).toBe('preview');
        for (const league of LEAGUES) {
            const { r } = await prep(league, `?ids=${MPJ}`, { flagOverrides: { 'bball-compare': false } });
            expect(r).toEqual({ notFound: true });
        }
        expect(reads.season).not.toHaveBeenCalled();
    });
    test('on: one season read, then each player\'s Impact and Value reads by person id; an id with no row keeps a card', async () => {
        const { r, set } = await prep('nba', `?ids=${MPJ},${CLOWNEY},999&season=2026`);
        if (!('entries' in r)) throw new Error('no page');
        expect(reads.season.mock.calls).toEqual([[2026, 'nba']]);
        expect(reads.impact.mock.calls.map((c) => c.slice(0, 3)).sort()).toEqual([['nba', 2026, MPJ], ['nba', 2026, CLOWNEY]]);
        expect(reads.war.mock.calls.map((c) => c.slice(0, 3)).sort()).toEqual([['nba', 2026, MPJ], ['nba', 2026, CLOWNEY]]);
        expect(r.entries.map((e) => e.id)).toEqual([String(MPJ), String(CLOWNEY), '999']);
        expect(r.entries[2]).toEqual({ id: '999', missing: true });
        expect(set).toHaveBeenLastCalledWith(false); // the id with no row: never cached
        const { set: clean } = await prep('nba', `?ids=${MPJ},${CLOWNEY}&season=2026`);
        expect(clean).toHaveBeenLastCalledWith(expect.objectContaining({ maxAge: 3600, tags: ['nba'] }));
    });
    test('a zero-padded id is the same player: one card, canonical spelling', async () => {
        const { r } = await prep('nba', `?ids=0${MPJ},${MPJ}&season=2026`);
        expect('entries' in r && r.entries.map((e) => e.id)).toEqual([String(MPJ)]);
    });
    test("a failed Value read is that card's dashes and an uncached page; a failed season read is the 503", async () => {
        reads.war.mockImplementation(async () => { throw new Error('Data API 502'); });
        const { r, set, astro } = await prep('nba', `?ids=${MPJ}&season=2026`);
        expect('entries' in r && r.entries[0]).toMatchObject({ war: null });
        expect(set).toHaveBeenLastCalledWith(false);
        expect(astro.response.headers.get('Cache-Control')).toBe('no-store');
        reads.season.mockImplementation(async () => { throw new Error('Data API 502'); });
        expect((await prep('nba', `?ids=${MPJ}&season=2026`)).r).toEqual({ unavailable: true });
    });
    test("each section's flag gates its read: 'bball-impact' and 'bball-war' off read neither", async () => {
        const { r } = await prep('nba', `?ids=${MPJ}&season=2026`, on({ 'bball-impact': false, 'bball-war': false }));
        expect(reads.impact).not.toHaveBeenCalled();
        expect(reads.war).not.toHaveBeenCalled();
        expect('entries' in r && Object.keys(r.entries[0]).sort()).toEqual(['headshot', 'id', 'player', 'row', 'season', 'teams']);
    });
    test("no ?season=: each card is that player's latest listed season (as football's), read by that season", async () => {
        const latest: Record<number, number[]> = { [MPJ]: [2019, 2025, 2026], [CLOWNEY]: [2025], 999: [] };
        reads.seasons.mockImplementation(async (id: number) => latest[id] ?? []);
        const { r, set } = await prep('nba', `?ids=${MPJ},${CLOWNEY},999`);
        if (!('entries' in r)) throw new Error('no page');
        expect(r.season).toBeNull();
        expect(reads.seasons.mock.calls.map((c) => c[0]).sort()).toEqual([999, MPJ, CLOWNEY].sort());
        // the add control's season (the current one) and each card's own, each read once
        expect(reads.season.mock.calls.map((c) => c[0]).sort()).toEqual([2025, 2026, r.current].sort());
        expect(r.entries.map((e) => ('season' in e ? e.season : null))).toEqual([2026, 2025, null]);
        expect(reads.impact.mock.calls.map((c) => c.slice(1, 3)).sort()).toEqual([[2025, CLOWNEY], [2026, MPJ]]);
        expect(reads.war.mock.calls.map((c) => c.slice(1, 3)).sort()).toEqual([[2025, CLOWNEY], [2026, MPJ]]);
        expect(r.entries[2]).toEqual({ id: '999', missing: true }); // no season with a row: a "no line" card, never cached
        expect(set).toHaveBeenLastCalledWith(false);
    });
    test('?season= pins every card to that season, with no season-list read; a failed season-list read keeps the card on the current season, uncached', async () => {
        await prep('nba', `?ids=${MPJ}&season=2026`);
        expect(reads.seasons).not.toHaveBeenCalled();
        reads.seasons.mockImplementation(async () => { throw new Error('Data API 502'); });
        const { r, set } = await prep('nba', `?ids=${MPJ}`);
        expect('entries' in r && r.entries[0]).toMatchObject({ season: 'current' in r ? r.current : 0 });
        expect(set).toHaveBeenLastCalledWith(false);
    });
    test('the add control: ?team= lists that team\'s players not already compared; an unknown team lists none', async () => {
        const { r } = await prep('nba', `?ids=${MPJ}&season=2026&team=1610612751`);
        expect('roster' in r && r.roster!.map((p) => p.person_id)).toEqual([CLOWNEY]);
        const { r: bad } = await prep('nba', `?ids=${MPJ}&season=2026&team=7`);
        expect('roster' in bad && [bad.team, bad.roster]).toEqual([null, null]);
    });
});

describe('the page', () => {
    test('NBA: two cards from the real reads, WAR and the shooting percentages shaded by their producer percentile with their rank, Impact unshaded', async () => {
        const page = await render('nba', `?ids=${MPJ},${CLOWNEY}&season=2026`);
        const [mpjWar] = byId(PC.nbaWar, MPJ);
        const mpj = card(page, MPJ);
        expect(mpj).toContain('Michael Porter Jr.');
        expect(mpj).toContain(`href="/nba/players/${MPJ}?season=2026"`);
        expect(mpj).toContain(`href="/nba/players/compare?ids=${CLOWNEY}&amp;season=2026"`); // Remove
        const value = cells(mpj, 'value');
        expect(value[0]).toEqual(['WAR', expect.stringContaining(generateColorRampValue(mpjWar.war_pct, 100)!), `${mpjWar.war.toFixed(1)} #46`]);
        expect(value[1][2]).toBe(`${mpjWar.war_lo.toFixed(1)} to ${mpjWar.war_hi.toFixed(1)}`);
        for (const [, cls, text] of cells(mpj, 'impact')) {
            expect(cls).toBe('text-center numeral');
            expect(text).not.toContain('#');
        }
        const [mpjRow] = PC.nbaSeasonPlayers.filter((r) => r.person_id === MPJ);
        const shooting = cells(mpj, 'shooting');
        expect(shooting.find(([label]) => label === 'FT%')).toEqual(['FT%', expect.stringContaining(generateColorRampValue(mpjRow.ft_pct_pct, 100)!), `${(mpjRow.ft_pct * 100).toFixed(1)}% #40`]);
        expect(shooting.find(([label]) => label === 'GP')![1]).toBe('text-center numeral');
        // a tie is "T-": Clowney's eFG% rank is 240.5
        expect(cells(card(page, CLOWNEY), 'shooting').find(([label]) => label === 'eFG%')![2]).toMatch(/% #T-240$/);
        // 'bball-war' on: Impact's WAR keeps its row as "Impact WAR"; plain WAR is Value's
        expect(cells(mpj, 'impact').filter(([label]) => label.includes('WAR')).map(([label]) => label)).toEqual(['Impact WAR']);
        expect(cells(card(page, CLOWNEY), 'value')[0][2]).toBe(`${byId(PC.nbaWar, CLOWNEY)[0].war.toFixed(1)} #286`);
        // the rows line up: both cards list the same labels in the same order
        for (const section of ['impact', 'value', 'shooting']) {
            expect(cells(card(page, CLOWNEY), section).map((c) => c[0])).toEqual(cells(mpj, section).map((c) => c[0]));
        }
        // every season is in its URL; the season-less URL is "Latest" (each player's latest season)
        expect(page).toMatch(/<option value="\/nba\/players\/compare\?ids=1629008,1641730&amp;season=2027"[^>]*>2026-27<\/option>/);
        expect(page).toContain('<option value="/nba/players/compare?ids=1629008,1641730">Latest</option>');
        expect(mpj).toContain('data-compare-season>2025-26</p>');
        expect(page).toContain(`value="/nba/players/compare?ids=${MPJ},${CLOWNEY}&amp;season=2026&amp;team=1610612751"`);
    });
    test("MBB, no ?season=: each player's latest season; Texas cards, player_value BPM and player_war WAR (#48 for Swain)", async () => {
        const page = await render('mbb', `?ids=${SWAIN},${MARK}`);
        expect(page).toMatch(/<option value="\/mbb\/players\/compare\?ids=4848625,4432243" selected[^>]*>Latest<\/option>/);
        expect(card(page, SWAIN)).toContain('data-compare-season>2025-26</p>');
        expect(card(page, SWAIN)).toContain(`href="/mbb/players/${SWAIN}"`); // 2025-26 is the MBB current season: his canonical page
        expect(page).toContain('each player’s latest season.');
        const swain = card(page, SWAIN);
        expect(swain).toContain('Dailyn Swain');
        expect(cells(swain, 'value')[0][2]).toBe(`${byId(PW.mbbTeam, SWAIN)[0].war.toFixed(1)} #48`);
        expect(cells(swain, 'impact').map((c) => c[0])).toEqual(['BPM', 'BPM off', 'BPM def']);
        expect(cells(card(page, MARK), 'value')[0][2]).toContain(`#${byId(PW.mbbTeam, MARK)[0].war_rank}`);
    });
    test('a two-team player: his season percentages and ranks (the same on each team row), his makes over both teams', async () => {
        feed.seasonRows = () => PC.nbaMultiTeam;
        try {
            const page = await render('nba', `?ids=${HARDEN}&season=2026`);
            const [a, b] = PC.nbaMultiTeam;
            expect([a.fg_pct_rank, a.fg_pct]).toEqual([b.fg_pct_rank, b.fg_pct]);
            const shooting = cells(card(page, HARDEN), 'shooting');
            expect(shooting.find(([label]) => label === 'FG')![2]).toBe(`${a.makes + b.makes}/${(a.attempts + b.attempts).toLocaleString('en-US')}`);
            expect(shooting.find(([label]) => label === 'FG%')![2]).toBe(`${(a.fg_pct * 100).toFixed(1)}% #${a.fg_pct_rank}`);
        } finally {
            feed.seasonRows = (league: string) => (league === 'mbb' ? PC.mbbSeasonPlayers : PC.nbaSeasonPlayers);
        }
    });
    test('four cards fill the page: the add control gives way to a note', async () => {
        const page = await render('mbb', `?ids=${SWAIN},${MARK},1,2`);
        expect(page).not.toContain('id="player-compare-team"');
        expect(page).toContain('four at most');
        expect(page.match(/data-compare-card=/g)).toHaveLength(4);
    });
});

describe("the player page's Compare button", () => {
    const strip = (html: string) => html.replace(/ uid="[^"]*"/g, '').replace(/data-astro-cid-[a-z0-9]+/g, '');
    const player = async (flag: boolean) => {
        const { default: Page } = await import('../src/pages/nba/players/[id].astro');
        return strip(await container.renderToString(Page, { params: { id: String(MPJ) }, request: new Request(`https://gameonpaper.com/nba/players/${MPJ}?season=2026`), locals: on({ 'bball-impact': false, 'bball-war': false, 'bball-compare': flag }) as unknown as App.Locals }));
    };
    test('on, it links to a comparison seeded with him for the season; off, the page is the same bytes without it', async () => {
        const [withIt, without] = [await player(true), await player(false)];
        const button = `<a class="btn btn-sm btn-outline-secondary" id="player-compare-link" href="/nba/players/compare?ids=${MPJ}&amp;season=2026">Compare</a>`;
        expect(withIt).toContain(button);
        expect(without).not.toContain('player-compare-link');
        expect(withIt.replace(button, '')).toBe(without);
    });
});
