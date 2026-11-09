import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/nba/game', () => ({ prepareNbaGame: (...a: unknown[]) => prep(...a) }));
const summary = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGameSummary: (...a: unknown[]) => summary(...a) }));
import Page from '../../src/pages/nba/game/[id].astro';
import { fromDataApi, fromProcessor } from '../../src/resources/nbaGame';
import { biggestPlays } from '../../src/nba/data/game';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const pre = (over: { broadcasts?: any[]; records?: boolean; awayId?: string } = {}) => ({ pregame: true, espnGame: { gameId: 1, gamepackageJSON: { header: { competitions: [{ date: '2026-10-22T01:00Z', status: { type: { name: 'STATUS_SCHEDULED', completed: false, description: 'Scheduled' } }, broadcasts: over.broadcasts ?? [], competitors: [
    { homeAway: 'home', team: { id: '19', abbreviation: 'ORL', location: 'Orlando', name: 'Magic', displayName: 'Orlando Magic' }, ...(over.records === false ? {} : { record: [{ summary: '0-0' }] }) },
    { homeAway: 'away', team: { id: over.awayId ?? '1', abbreviation: 'ATL', location: 'Atlanta', name: 'Hawks', displayName: 'Atlanta Hawks' }, ...(over.records === false ? {} : { record: [{ summary: '0-0' }] }) } ] }] } } } });
const plain = (h: string) => h.replace(/<[^>]+>/g, '');
const ISLAND = /<astro-island(?:\s+[\w-]+(?:="[^"]*")?)*\s*>/g;
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(ISLAND, ''); // layout scripts and island props legitimately contain null/undefined
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = () => container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/game/401766458'), params: { id: '401766458' }, locals: { preview: true, league: 'nba' } as App.Locals });

describe('/nba/game/[id] render', () => {
    test('a final game: title with scores, linescore, prior line once, six panels with bodies, breadcrumb', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401766458_processor'), 'nba') });
        const html = await render();
        expect(plain(html)).toContain('Atlanta 95 @ Orlando 120');
        expect(html).toContain('href="/nba/scoreboard"');
        for (const id of ['wp', 'factors', 'teambox', 'players', 'shots', 'plays']) expect(html).toContain(`id="${id}"`);
        expect(html).toContain('eFG%'); // the panel body renders, not just the id
        expect(html).toMatch(/<th[^>]*>1<\/th>[\s\S]*<th[^>]*>4<\/th>/);
        expect(html.match(/home-court advantage/g)?.length).toBe(1);
        expect(plain(html).match(/no line/gi)?.length).toBe(1); // "No line, ... (home-court advantage only)", said once
        expect(html).not.toContain(' · ');
        const body = noScripts(html);
        for (const bad of ['NaN', 'null', 'undefined']) expect(body).not.toContain(bad);
    });
    test('shot charts: one per team, and the no-locations message when every shot is unlocated', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401766458_processor'), 'nba') });
        let html = await render();
        expect((html.match(/class="nba-chart"/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect(html).toContain('aria-pressed');
        const j = read('game_401766458_processor');
        for (const p of j.plays) { p.x_legacy = null; p.y_legacy = null; }
        prep.mockResolvedValueOnce({ game: fromProcessor(j, 'nba') });
        html = await render();
        expect(html).toContain('no shot locations for this game');
        expect(html).not.toContain('class="nba-chart"');
    });
    test('a null prior renders "no prior" without crashing', async () => {
        prep.mockResolvedValueOnce({ game: { ...fromProcessor(read('game_401766458_processor'), 'nba'), prior: null } });
        const html = await render();
        expect(html).toContain('no prior');
        expect(noScripts(html)).not.toContain('undefined');
    });
    test('a pregame renders teams, records, broadcast from media.shortName and no panels', async () => {
        summary.mockResolvedValueOnce(null);
        prep.mockResolvedValueOnce({ pregame: true, espnGame: { gameId: 1, gamepackageJSON: { header: { competitions: [{ date: '2026-10-21T23:00Z', status: { type: { name: 'STATUS_SCHEDULED', completed: false, description: 'Scheduled', detail: '10/21 - 7:00 PM EDT' } }, broadcasts: [{ media: { shortName: 'ESPN' } }], competitors: [
            { homeAway: 'home', team: { id: '19', abbreviation: 'ORL', location: 'Orlando', name: 'Magic', displayName: 'Orlando Magic' }, record: [{ summary: '0-0' }] },
            { homeAway: 'away', team: { id: '1', abbreviation: 'ATL', location: 'Atlanta', name: 'Hawks', displayName: 'Atlanta Hawks' }, record: [{ summary: '0-0' }] } ] }], season: { year: 2027, type: 2 } } } } });
        const html = await render();
        expect(plain(html)).toContain('Atlanta @ Orlando');
        expect(html).toContain('ESPN');
        expect(html).toContain('ATL 0-0, ORL 0-0');
        expect(html).not.toContain('id="wp"');
    });
    test('the Data API path: a real line, the spread source, no home-court sentence', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401766458_api'), 'nba') });
        const body = noScripts(await render());
        expect(body).toContain('Line: ORL -6');
        expect(body).toContain('(from the spread)');
        expect(body).not.toContain('home-court');
    });
    test('the back link goes to the scoreboard day of the game (Eastern time)', async () => {
        const game = fromProcessor(read('game_401766458_processor'), 'nba');
        prep.mockResolvedValueOnce({ game: { ...game, date: '2026-10-22T01:00:00Z' } });
        expect(await render()).toContain('href="/nba/scoreboard?date=2026-10-21"');
        prep.mockResolvedValueOnce({ game: { ...game, date: '1990-01-01T00:00:00Z' } });
        const html = await render();
        expect(html).toContain('href="/nba/scoreboard"');
        expect(html).not.toContain('scoreboard?date=1990');
    });
    test('spread 0 is PK; a live game without detail does not print a bare "LIVE - "', async () => {
        const game = fromProcessor(read('game_401766458_processor'), 'nba');
        prep.mockResolvedValueOnce({ game: { ...game, prior: { ...game.prior!, homeTeamSpread: 0, gameSpreadAvailable: true, source: 'spread' } } });
        expect(noScripts(await render())).toContain('Line: PK');
        prep.mockResolvedValueOnce({ game: { ...game, prior: null, status: { ...game.status, completed: false, name: 'STATUS_IN_PROGRESS', detail: null } } });
        const html = noScripts(await render());
        expect(html).not.toContain('LIVE - ');
        expect(html).toContain('No line, no prior');
    });
    test('team names link to /nba/team/<stats id> for a known ESPN id, and stay plain for an unknown one', async () => {
        summary.mockResolvedValueOnce(null);
        prep.mockResolvedValueOnce(pre());
        const html = await render();
        expect(html).toContain('href="/nba/team/1610612753"'); // ORL, ESPN id 19
        expect(html).toContain('href="/nba/team/1610612737"'); // ATL, ESPN id 1
        summary.mockResolvedValueOnce(null);
        prep.mockResolvedValueOnce(pre({ awayId: '9999' }));
        const h2 = await render();
        expect(h2).toContain('href="/nba/team/1610612753"');
        expect(h2).not.toContain('href="/nba/team/1610612737"');
        expect(h2).toContain('Atlanta');
    });
    test('the pregame line shows the pickcenter details only when ESPN has one', async () => {
        summary.mockResolvedValueOnce({ pickcenter: [{ details: 'ORL -3.5' }] });
        prep.mockResolvedValueOnce(pre());
        expect(noScripts(await render())).toContain('Line: ORL -3.5');
        expect(summary).toHaveBeenLastCalledWith(1, 'nba', expect.any(AbortSignal));
        summary.mockResolvedValueOnce({ pickcenter: [] });
        prep.mockResolvedValueOnce(pre());
        expect(noScripts(await render())).not.toContain('Line:');
        summary.mockResolvedValueOnce(null);
        prep.mockResolvedValueOnce(pre());
        expect(noScripts(await render())).not.toContain('Line:');
    });
    test('a pregame with no records prints no empty record, no "()"', async () => {
        summary.mockResolvedValueOnce(null);
        prep.mockResolvedValueOnce(pre({ records: false }));
        const body = noScripts(await render());
        expect(body).toContain('ATL, ORL');
        expect(body).not.toContain('()');
        expect(body).not.toMatch(/ATL ,/);
    });
    test('unavailable is a 503 with no-store; notFound rewrites to /404', async () => {
        prep.mockResolvedValueOnce({ unavailable: true });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/nba/game/401766458'), params: { id: '401766458' }, locals: { preview: true, league: 'nba' } as App.Locals });
        expect(res.status).toBe(503);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const src = readFileSync(new URL('../../src/pages/nba/game/[id].astro', import.meta.url)).toString();
        expect(src).toContain("'notFound' in r");
        expect(src).toContain("Astro.rewrite('/404')");
    });
    test('four factors, team box and player boxes with TS%, usage, DNP reasons and dashes', async () => {
        const game = fromProcessor(read('game_401766458_processor'), 'nba');
        prep.mockResolvedValueOnce({ game });
        const body = noScripts(await render());
        for (const t of ['eFG%', 'ORtg', 'Pace', 'Fast break points', 'USG%', 'TS%']) expect(body).toContain(t);
        expect(body).toContain((100 * game.home.rates!.efg_pct!).toFixed(1));
        expect(body).toContain('id="box-away"');
        expect(body).toContain('table-fix-first-col');
        const dnp = [...game.home.players, ...game.away.players].find((p) => p.did_not_play);
        if (dnp) expect(body).toContain(dnp.reason ?? 'DNP');
        expect(body).toContain('–');
        expect(body).not.toMatch(/>null<|>undefined<|NaN|null-null/);
    });
    test('four factors: bold marks the better side (lower TOV% wins), both tables scroll and name the metric column', async () => {
        const game = fromProcessor(read('game_401766458_processor'), 'nba');
        prep.mockResolvedValueOnce({ game });
        const body = noScripts(await render());
        const row = (label: string) => body.match(new RegExp(`<th scope="row"[^>]*>${label}</th>(.*?)</tr>`))![1];
        const tov = row('TOV%');
        expect(tov).toMatch(/<td class="[^"]*fw-bold[^"]*">7\.5%<\/td>\s*<td class="[^"]*">8\.9%<\/td>/); // ATL (away) 7.5 beats ORL 8.9
        expect(tov).not.toMatch(/8\.9%<\/td>.*fw-bold/);
        expect(row('Possessions')).not.toContain('fw-bold');
        expect(body.match(/<div class="table-responsive"><table[^>]*aria-label="(Four factors|Team box score)"/g)).toHaveLength(2);
        expect(body.match(/<span class="visually-hidden">Metric<\/span>/g)!.length).toBeGreaterThanOrEqual(2);
    });
    test('a null leading total collapses the parenthesised team-box cells to a single dash', async () => {
        const g = fromProcessor(read('game_401766458_processor'), 'nba');
        g.home.box!.total_rebounds = null; g.home.box!.total_turnovers = null;
        prep.mockResolvedValueOnce({ game: g });
        const body = noScripts(await render());
        expect(body).not.toMatch(/–\s*\(/);
        expect(body).not.toContain('– + –');
    });
    test('null team-box counts and rates render dashes, not null or NaN', async () => {
        const g = fromProcessor(read('game_401766458_processor'), 'nba');
        g.home.box!.field_goals_made = null; g.home.box!.total_turnovers = null; g.home.rates!.efg_pct = null; g.home.rates!.game_minutes = null; g.away.rates!.game_minutes = null;
        prep.mockResolvedValueOnce({ game: g });
        const body = noScripts(await render());
        expect(body).not.toMatch(/null|NaN|undefined/);
        expect(body).not.toContain('per 48 minutes');
    });
    test('an overtime game labels OT and reports 53 minutes of pace', async () => {
        const j = read('game_401766458_processor');
        j.periods = 5; j.teams.home.rates.game_minutes = 53; j.teams.away.rates.game_minutes = 53; j.plays.push({ ...j.plays.at(-1), period_number: 5, wp_regime: 'ot', game_play_number: 9999 });
        prep.mockResolvedValueOnce({ game: fromProcessor(j, 'nba') });
        const html = await render();
        expect(html).toContain('>OT<');
        expect(html).toContain('per 53 minutes');
    });
    test('win probability: the chart island (no duplicate ids), the biggest plays and the plays table grouped by period', async () => {
        const game = fromProcessor(read('game_401766458_processor'), 'nba');
        prep.mockResolvedValueOnce({ game });
        const html = await render();
        const tag = [...html.matchAll(ISLAND)].map((m) => m[0]).find((t) => t.includes('/WinProbabilityChart.svelte"')) ?? '';
        expect(tag).not.toBe('');
        const props = tag.replace(/&quot;/g, '"');
        expect(props).toContain('"showOdds":[0,false]');
        expect(props).toContain('"allPeriodMarkers":[0,true]');
        expect(props).toContain('"gameSpreadAvailable":[0,');
        expect(html).toContain('id="wp-section"');
        expect(html).not.toContain('id="wp_container"'); // the island owns wp_container and canvas#wpChart
        expect(html).not.toContain('id="wpChart"');
        expect(html).toContain('Biggest plays');
        const top = biggestPlays(game.plays)[0];
        expect(html).toContain(top.text.slice(0, 40).replace(/&/g, '&amp;'));
        expect(html).toContain('4th Quarter');
        expect((html.match(/class="[^"]*nba-scoring-play/g) ?? []).length).toBeGreaterThan(50);
        expect(plain(html)).not.toMatch(/default values|Game Excitement|-2\.5/);
        const body = noScripts(html);
        expect(body).not.toMatch(/NaN|undefined/);
        expect(body).not.toContain(' · ');
    });
    test('win probability with no prior: footnote says so, nothing crashes', async () => {
        prep.mockResolvedValueOnce({ game: { ...fromProcessor(read('game_401766458_processor'), 'nba'), prior: null } });
        const html = noScripts(await render());
        expect(html).toContain('This game has no pregame prior.');
        expect(html).toContain('id="wp-section"');
        expect(html).not.toContain('undefined');
    });
    test('an overtime game: 2OT plays table section, the OT regime footnote, both periods in the swing labels', async () => {
        const j = read('game_401766458_processor');
        j.periods = 6;
        const last = j.plays.at(-1);
        j.plays.push({ ...last, period_number: 5, wp_regime: 'ot', game_play_number: 9998, home_win_prob: 0.4, wp_delta: 0.3, type_text: 'Jump Shot', text: 'OT swing play', id: 'ot1' });
        j.plays.push({ ...last, period_number: 6, wp_regime: 'ot', game_play_number: 9999, home_win_prob: 0.7, wp_delta: -0.35, type_text: 'Jump Shot', text: '2OT swing play', id: 'ot2' });
        const game = fromProcessor(j, 'nba');
        prep.mockResolvedValueOnce({ game });
        const html = await render();
        expect(html).toContain('Overtime');
        expect(html).toContain('>2OT<');
        expect(html).toContain('overtime regime');
        expect(html).toContain('2OT swing play');
        expect(html).toContain('2nd Overtime');
        expect(html.match(/<td>OT<\/td>/)).not.toBeNull();
        expect(html.match(/<td>2OT<\/td>/)).not.toBeNull();
    });
    test('football WinProbabilityChart props carry no showOdds (the NBA flag is opt-in)', () => {
        const src = readFileSync(new URL('../../src/components/game/GamePage.astro', import.meta.url)).toString();
        expect(src).not.toContain('showOdds');
        expect(src).not.toContain('allPeriodMarkers');
    });
    test('plays table: a final opens every period; a live game opens only the current one; the score header names the order', async () => {
        const game = fromProcessor(read('game_401766458_processor'), 'nba');
        prep.mockResolvedValueOnce({ game });
        const fin = await render();
        const det = (h: string) => [...h.matchAll(/<details( [^>]*)?>/g)].map((m) => m[1] ?? "");
        expect(det(fin).length).toBe(4);
        expect(det(fin).every((a) => a.includes('open'))).toBe(true);
        expect(plain(fin)).toContain('Score (ATL-ORL)');
        for (const period of [3, null]) {
            prep.mockResolvedValueOnce({ game: { ...game, status: { ...game.status, completed: false, name: 'STATUS_IN_PROGRESS', period } } });
            const open = det(await render()).filter((a) => a.includes('open')).length;
            expect(open).toBe(period === 3 ? 2 : 4); // Q3 and Q4 (>= current); an unknown period opens all
        }
    });
});

describe('self-review round 1', () => {
    const procGame = () => fromProcessor(read('game_401766458_processor'), 'nba');
    test('the WP chart and the date hold their space before hydration; the linescore corner is named', async () => {
        prep.mockResolvedValueOnce({ game: procGame() });
        const html = await render();
        expect(html).toContain('aspect-ratio: 2 / 1');
        expect(html).toMatch(/<th scope="col"><span class="visually-hidden">Team<\/span><\/th>/);
    });
    test('a suspended game is not LIVE', async () => {
        const g = procGame();
        prep.mockResolvedValueOnce({ game: { ...g, status: { ...g.status, completed: false, name: 'STATUS_SUSPENDED', detail: 'Suspended' } } });
        expect(plain(noScripts(await render()))).not.toContain('LIVE');
    });
    test('a missing shooting count is a dash, never 0-0; an ejected player is marked', async () => {
        const raw = read('game_401766458_processor');
        raw.players.home[0] = { ...raw.players.home[0], field_goals_made: null, ejected: true };
        const g = fromProcessor(raw, 'nba');
        expect(g.home.players[0].fg).toBe('–');
        prep.mockResolvedValueOnce({ game: g });
        expect(await render()).toContain('title="Ejected"');
    });
});
