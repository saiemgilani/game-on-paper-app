// astro/test/basketball/hubDashboards.test.ts
// BB-G49's dashboards on the league hub, behind 'bball-hub-dashboards' (on top of 'bball-hub'): the season's WAR leaders and
// "follow a team" (a browser-kept pick showing that team's last and next game, record, conference seed or poll rank, and rating rank). Real ESPN scoreboard captures
// with the real player_war and schedule rows (fixtures/README.md); the Data API is a mocked retrieveRowsFrom, fetch fails the
// file on any network call, and the picker's inline script runs in jsdom against the rendered page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { followTeams, warLeaders } from '../../src/basketball/hub';
import { BASKETBALL } from '../../src/basketball/config';
import { LEAGUES as LEAGUE_CONFIG, type BasketballLeague } from '../../src/utils/league';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (u: unknown) => { fetched.push(String(u)); throw new Error(`network: ${String(u)}`); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const fix = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url));
const gz = (p: string) => JSON.parse(gunzipSync(fix(p)).toString());
const LINES = JSON.parse(fix('hub-game-lines.json').toString()) as Record<string, any[]>;
const BOX = gz('hub-standouts-box.json.gz') as Record<string, any[]>;
const WP = gz('hub-play-wp.json.gz') as Record<string, number[]>;
/** `<league>:<season>` -> the real player_war top 25 (the site's current season) / the real season schedule (the boards' seasons) */
const WAR = JSON.parse(fix('hub-war-leaders.json').toString()) as Record<string, any[]>;
const SCHED = gz('hub-season-schedule.json.gz') as Record<string, any[]>;
/** the real latest season_standings snapshot (pros) and team_strength rows of the boards' seasons */
const SS = gz('hub-standings-strength.json.gz') as { season_standings: Record<string, any[]>; team_strength: Record<string, any[]> };
const BOARDS: Record<BasketballLeague, string> = {
    nba: 'nba/scoreboard-20250115.json', wnba: 'wnba/scoreboard-20250801.json', mbb: 'mbb/scoreboard-20250222-top25.json', wbb: 'wbb/scoreboard-20260207-top25.json',
};
const events = (lg: BasketballLeague) => JSON.parse(fix(BOARDS[lg]).toString()).content.sbData.events as any[];
const DAYS: Record<BasketballLeague, string> = { nba: '2025-01-15', wnba: '2025-08-01', mbb: '2025-02-22', wbb: '2026-02-07' };
const LEAGUES = ['nba', 'wnba', 'mbb', 'wbb'] as const;
const warSeason = (lg: BasketballLeague) => LEAGUE_CONFIG[lg].seasons[LEAGUE_CONFIG[lg].seasons.length - 1];
const boardSeason = (lg: BasketballLeague) => events(lg)[0].season.year as number;
const producer = (lg: BasketballLeague, season = boardSeason(lg)) => ({ standings: SS.season_standings[`${lg}:${season}`] ?? [], strength: SS.team_strength[`${lg}:${season}`] ?? [] });

const sb = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sb(...a) }));
const rows = vi.fn();
vi.mock('../../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../../src/resources/sdv')>()), retrieveRowsFrom: (...a: unknown[]) => rows(...a) }));
/** The hub's own reads, answered from the fixtures. */
const dataFrom = (lg: string) => async (_src: unknown, table: string, q: Record<string, string>) => {
    if (table === 'game_lines') return LINES[lg].filter((r) => String(r.game_id) === q.game_id);
    if (table === 'player_box') return BOX[`${lg}:${q.game_date}`] ?? [];
    if (table === 'play_wp') return (WP[q.game_id] ?? []).map((home_win_prob, i) => ({ game_play_number: i + 1, home_win_prob }));
    if (table === 'player_war') return WAR[`${lg}:${q.season}`] ?? [];
    if (table === 'schedule') return SCHED[`${lg}:${q.season}`] ?? [];
    if (table === 'season_standings') return SS.season_standings[`${lg}:${q.season}`] ?? [];
    if (table === 'team_strength') return SS.team_strength[`${lg}:${q.season}`] ?? [];
    throw new Error(`unexpected read ${table}`);
};
const teams = vi.fn(async () => ({ unavailable: true }));
vi.mock('../../src/routes/basketball/teams', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/teams')>()), prepareBasketballTeams: (...a: unknown[]) => teams(...a) }));
beforeEach(() => { sb.mockReset(); rows.mockReset(); teams.mockClear(); });
const reads = (table: string) => rows.mock.calls.filter((c) => c[1] === table).map((c) => ({ schema: c[0].schema as string, ...(c[2] as Record<string, string>) }));
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '');

/** As the NBA byte-identity test: the checkout root (island component-urls), island uids and scoped-style ids are host bytes. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T16:00:00Z')); // the scoreboard's off-day check reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
const render = async (lg: BasketballLeague, locals: Partial<App.Locals> = { preview: true }) => {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/${lg}/index.astro`);
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/${lg}`), locals: locals as App.Locals });
};
const board = (lg: BasketballLeague) => sb.mockResolvedValue({ day: DAYS[lg], events: events(lg), degraded: false });

describe("flag off: BB-G48's hub, byte for byte, and no new read", () => {
    for (const lg of LEAGUES) {
        test(lg, async () => {
            board(lg);
            rows.mockImplementation(dataFrom(lg));
            const html = await render(lg, { preview: true, flagOverrides: { 'bball-hub-dashboards': false } });
            // the snapshots were written by BB-G48's code (feat/basketball-hub-tonight at 7142124a, 'bball-hub-tonight' on), before this change
            await expect(normalize(html)).toMatchFileSnapshot(`./__hub_byte_identity__/tonight-${lg}.html`);
            expect(new Set(rows.mock.calls.map((c) => c[1]))).toEqual(new Set(['game_lines', 'player_box', 'play_wp']));
        });
    }
});

describe('warLeaders', () => {
    for (const lg of LEAGUES) {
        test(`${lg}: the real top 25, best first, every team resolved, linked to the player pages`, () => {
            const raw = WAR[`${lg}:${warSeason(lg)}`];
            expect(raw).toHaveLength(25);
            const w = warLeaders(lg, raw);
            expect(w).toHaveLength(25);
            for (let i = 1; i < w.length; i++) expect(w[i - 1].war).toBeGreaterThanOrEqual(w[i].war);
            for (const [i, p] of w.entries()) {
                expect(p.team, p.name).toMatch(/^[A-Z&]{2,5}$/);
                expect(p.href).toBe(`/${lg}/players/${raw.find((r) => r.player_name === p.name)!.player_id}`);
                expect(Number.isFinite(p.war), String(i)).toBe(true);
            }
        });
    }
    test('a row without a WAR number is left out', () => {
        const [a, b] = WAR['nba:2027'];
        expect(warLeaders('nba', [{ ...a, war: null }, b]).map((p) => p.name)).toEqual([b.player_name]);
        expect(warLeaders('nba', [])).toEqual([]);
    });
});

describe('followTeams', () => {
    for (const lg of LEAGUES) {
        test(`${lg}: every team, its last final before the board's day and its next game from it`, () => {
            const sched = SCHED[`${lg}:${boardSeason(lg)}`];
            const f = followTeams(lg, sched, DAYS[lg]);
            const cfg = BASKETBALL[lg];
            // the teams that played that season (the WNBA's 2025 had 13; the pickers list today's franchises)
            const ids = cfg.currentMembers ? cfg.currentMembers.ids : cfg.teams.all.map((t) => t.espn_id);
            const expected = ids.filter((id) => sched.some((g) => Number(g.home_id) === id || Number(g.away_id) === id)).length;
            expect(f).toHaveLength(expected);
            expect(f.map((t) => t.name)).toEqual([...f.map((t) => t.name)].sort((a, b) => a.localeCompare(b)));
            const byId = new Map(sched.map((g) => [String(g.game_id), g]));
            for (const t of f) {
                if (t.last) {
                    expect(t.last.date < DAYS[lg] || byId.get(t.last.id)!.status_type_completed, t.name).toBe(true);
                    expect(t.last.result, t.name).toMatch(/^[WLT] \d+-\d+$/);
                }
                if (t.next) {
                    expect(t.next.date >= DAYS[lg], t.name).toBe(true);
                    expect(byId.get(t.next.id)!.status_type_name, t.name).not.toMatch(/POSTPONED|CANCELED|FORFEIT/);
                }
                expect(t.href, t.name).toBe(`/${lg}/team/${cfg.currentMembers ? t.id : cfg.teams.byEspnId(Number(t.id))!.team_id}`);
            }
            // mid-season boards: every team has played and has a game left
            expect(f.filter((t) => t.last && t.next).length / f.length).toBeGreaterThan(0.9);
        });
    }
    test("pros: the record and conference seed from season_standings, the rating rank from team_strength", () => {
        const f = followTeams('nba', SCHED['nba:2025'], '2025-06-01', producer('nba', 2025));
        const w = f.reduce((s, t) => s + Number(t.record!.split('-')[0]), 0), l = f.reduce((s, t) => s + Number(t.record!.split('-')[1]), 0);
        expect(w).toBe(l);
        expect(w).toBe(1230); // the standings' regular season: 82 games x 30 teams / 2
        const cle = f.find((t) => t.name === 'Cleveland Cavaliers')!;
        expect([cle.record, cle.rank, cle.rating]).toEqual(['64-18', '1st in the East', '2nd in our team ratings']);
        const okc = f.find((t) => t.name === 'Oklahoma City Thunder')!;
        expect([okc.record, okc.rank, okc.rating]).toEqual(['68-14', '1st in the West', '1st in our team ratings']);
        for (const t of f) expect(t.rank, t.name).toMatch(/^\d+(st|nd|rd|th) in the (East|West)$/);
        const wn = followTeams('wnba', SCHED['wnba:2025'], DAYS.wnba, producer('wnba'));
        expect(wn.find((t) => t.rank === '1st in the WNBA')).toBeDefined();
        for (const t of wn) expect(t.rating, t.name).toMatch(/^\d+(st|nd|rd|th) in our team ratings$/);
    });
    test('pros without producer rows: no record, rank or rating (the site never counts them)', () => {
        for (const t of followTeams('nba', SCHED['nba:2025'], DAYS.nba)) expect([t.record, t.rank, t.rating], t.name).toEqual([null, null, null]);
    });
    test("college: the poll rank of the latest regular-season row, top 25 only; record and rating rank from team_strength", () => {
        const f = followTeams('wbb', SCHED['wbb:2026'], DAYS.wbb, producer('wbb'));
        const ranked = f.filter((t) => t.rank);
        expect(ranked.length).toBeGreaterThan(15);
        expect(ranked.length).toBeLessThanOrEqual(25);
        for (const t of ranked) expect(t.rank).toMatch(/^No\. ([1-9]|1\d|2[0-5]) in the poll$/);
        const ucla = f.find((t) => t.id === '26')!;
        expect([ucla.record, ucla.rating]).toEqual(['37-1', '2nd in our team ratings']);
        expect(followTeams('mbb', SCHED['mbb:2025'], DAYS.mbb, producer('mbb')).find((t) => t.id === '2')!.rating).toBe('3rd in our team ratings'); // Auburn
        const end = followTeams('wbb', SCHED['wbb:2026'], '2026-05-01');
        const champ = end.find((t) => t.id === '26')!; // UCLA, the 2026 final above
        expect(champ.next).toBeNull();
        expect(champ.last!.result).toBe('W 79-51');
    });
    test('no rows: no teams', () => { expect(followTeams('mbb', [], DAYS.mbb)).toEqual([]); });
});

describe('/<league> behind bball-hub-dashboards', () => {
    for (const lg of LEAGUES) {
        test(`${lg}: the follow picker first, the WAR table before the index, one read of each table`, async () => {
            board(lg);
            rows.mockImplementation(dataFrom(lg));
            const html = await render(lg);
            const war = reads('player_war'), sched = reads('schedule'), standings = reads('season_standings'), strength = reads('team_strength');
            expect(war).toEqual([expect.objectContaining({ season: String(warSeason(lg)), order: '-war', limit: '25' })]);
            expect(war[0].schema).toBe(LEAGUE_CONFIG[lg].sdvSchema);
            expect(sched).toEqual([expect.objectContaining({ schema: lg, season: String(boardSeason(lg)), limit: '50000' })]);
            const stats = LEAGUE_CONFIG[lg].sdvSchema;
            expect(strength).toEqual([expect.objectContaining({ schema: stats, season: String(boardSeason(lg)) })]);
            expect(standings).toEqual(lg === 'nba' || lg === 'wnba' ? [expect.objectContaining({ schema: stats, season: String(boardSeason(lg)), order: '-as_of_date' })] : []);
            const f = followTeams(lg, SCHED[`${lg}:${boardSeason(lg)}`], DAYS[lg], producer(lg));
            expect(f.filter((t) => t.rating).length / f.length, 'rated').toBeGreaterThan(0.9);
            expect((html.match(/<option value="\d+">/g) ?? []).length).toBe(f.length);
            const data = JSON.parse(new JSDOM(html).window.document.getElementById('hub-follow-data')!.textContent!);
            expect(data).toEqual(JSON.parse(JSON.stringify(f)));
            expect((html.match(/<tr><td>\d+<\/td>/g) ?? []).length).toBe(25);
            const at = (id: string) => html.indexOf(`id="${id}"`);
            expect(at('hub-follow')).toBeLessThan(at('hub-games'));
            expect(at('hub-standouts')).toBeLessThan(at('hub-war'));
            expect(at('hub-war')).toBeLessThan(at('hub-index'));
            expect(html).toContain(`WAR leaders, ${lg === 'nba' ? '2026-27' : lg === 'wnba' ? '2026' : '2025-26'}`);
            for (const bad of ['NaN', 'undefined', 'null']) expect(noScripts(html)).not.toContain(bad);
        });
    }
    test('failed reads: no follow block and no WAR table, the hub still renders', async () => {
        board('wnba');
        rows.mockImplementation(async (src: unknown, table: string, q: Record<string, string>) => { if (table === 'player_war' || table === 'schedule') throw new Error('503'); return dataFrom('wnba')(src, table, q); });
        const html = await render('wnba');
        expect(html).not.toContain('id="hub-follow"');
        expect(html).not.toContain('id="hub-war"');
        expect(html).toContain('id="hub-index"');
    });
    test('failed standings and strength reads: the follow block stands without the record, rank and rating', async () => {
        board('nba');
        rows.mockImplementation(async (src: unknown, table: string, q: Record<string, string>) => { if (table === 'season_standings' || table === 'team_strength') throw new Error('503'); return dataFrom('nba')(src, table, q); });
        const html = await render('nba');
        const data = JSON.parse(new JSDOM(html).window.document.getElementById('hub-follow-data')!.textContent!) as any[];
        expect(data.length).toBe(30);
        for (const t of data) expect([t.record, t.rank, t.rating]).toEqual([null, null, null]);
    });
    test('a board with no games names no season: the WAR table, no follow block, no schedule read', async () => {
        sb.mockResolvedValue({ day: '2025-02-14', events: [], degraded: false });
        rows.mockImplementation(dataFrom('nba'));
        const html = await render('nba');
        expect(reads('schedule')).toEqual([]);
        expect(reads('season_standings')).toEqual([]);
        expect(reads('team_strength')).toEqual([]);
        expect(html).not.toContain('id="hub-follow"');
        expect(html).toContain('id="hub-war"');
    });
    test("'bball-hub-dashboards' alone does nothing: with 'bball-hub' off the landing is today's and nothing is read", async () => {
        await render('wnba', { preview: true, flagOverrides: { 'bball-hub': false, 'bball-hub-dashboards': true } });
        expect(teams).toHaveBeenCalledTimes(1);
        expect(sb).not.toHaveBeenCalled();
        expect(rows).not.toHaveBeenCalled();
    });
});

describe('the follow picker in a browser', () => {
    /** The rendered hub in jsdom with its follow script run; `storage` stands in for window.localStorage. */
    const page = async (lg: BasketballLeague, storage: () => Storage, search = '') => {
        board(lg);
        rows.mockImplementation(dataFrom(lg));
        const html = await render(lg);
        const dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://gameonpaper.com/${lg}${search}` });
        Object.defineProperty(dom.window, 'localStorage', { get: storage, configurable: true });
        const script = [...dom.window.document.querySelectorAll('#hub-follow script:not([type])')].map((s) => s.textContent).join('\n');
        expect(script).toContain('gop-follow-');
        dom.window.eval(script);
        return dom.window;
    };
    const memory = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } as unknown as Storage & { m: Map<string, string> }; };

    test('a saved team is on top at load: its name, record, rank and both games linked', async () => {
        const store = memory({ 'gop-follow-nba': '5' }); // Cleveland
        const w = await page('nba', () => store);
        const card = w.document.getElementById('hub-follow-card')!;
        expect(card.hidden).toBe(false);
        expect((w.document.getElementById('hub-follow-pick') as HTMLSelectElement).value).toBe('5');
        const cle = followTeams('nba', SCHED['nba:2025'], DAYS.nba, producer('nba')).find((t) => t.id === '5')!;
        expect(card.textContent).toContain('Cleveland Cavaliers 64-18, 1st in the East, 2nd in our team ratings');
        const links = [...card.querySelectorAll('a')].map((a) => a.getAttribute('href'));
        expect(links).toEqual([cle.href, `/nba/game/${cle.last!.id}`, `/nba/game/${cle.next!.id}`]);
        expect(card.textContent).toContain(`Last game: ${cle.last!.result} ${cle.last!.home ? 'vs' : 'at'} ${cle.last!.opp}`);
    });
    test('picking a team keeps it in the browser; clearing the pick forgets it', async () => {
        const store = memory();
        const w = await page('mbb', () => store);
        const pick = w.document.getElementById('hub-follow-pick') as HTMLSelectElement;
        expect(w.document.getElementById('hub-follow-card')!.hidden).toBe(true);
        pick.value = '2'; // Auburn
        pick.dispatchEvent(new w.Event('change'));
        expect(store.m.get('gop-follow-mbb')).toBe('2');
        expect(w.document.getElementById('hub-follow-card')!.textContent).toContain('Auburn Tigers');
        pick.value = '';
        pick.dispatchEvent(new w.Event('change'));
        expect(store.m.has('gop-follow-mbb')).toBe(false);
        expect(w.document.getElementById('hub-follow-card')!.hidden).toBe(true);
    });
    test('storage that throws (private mode, blocked site data): no error, the pick still shows its card', async () => {
        const w = await page('wbb', () => { throw new Error('SecurityError: denied'); });
        const pick = w.document.getElementById('hub-follow-pick') as HTMLSelectElement;
        pick.value = pick.options[1].value;
        pick.dispatchEvent(new w.Event('change'));
        expect(w.document.getElementById('hub-follow-card')!.hidden).toBe(false);
    });
    test('?follow=<id> shows that team for the visit and leaves the saved pick alone', async () => {
        const store = memory({ 'gop-follow-nba': '5' });
        const w = await page('nba', () => store, '?follow=25'); // Oklahoma City
        expect(w.document.getElementById('hub-follow-card')!.textContent).toContain('Oklahoma City Thunder 68-14, 1st in the West, 1st in our team ratings');
        expect(store.m.get('gop-follow-nba')).toBe('5');
    });
    test('a saved id the league no longer lists is ignored', async () => {
        const w = await page('wnba', () => memory({ 'gop-follow-wnba': '999999' }));
        expect(w.document.getElementById('hub-follow-card')!.hidden).toBe(true);
        expect((w.document.getElementById('hub-follow-pick') as HTMLSelectElement).value).toBe('');
    });
});
