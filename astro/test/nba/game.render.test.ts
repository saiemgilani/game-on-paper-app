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

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const pre = (over: { broadcasts?: any[]; records?: boolean; awayId?: string } = {}) => ({ pregame: true, espnGame: { gameId: 1, gamepackageJSON: { header: { competitions: [{ date: '2026-10-22T01:00Z', status: { type: { name: 'STATUS_SCHEDULED', completed: false, description: 'Scheduled' } }, broadcasts: over.broadcasts ?? [], competitors: [
    { homeAway: 'home', team: { id: '19', abbreviation: 'ORL', location: 'Orlando', name: 'Magic', displayName: 'Orlando Magic' }, ...(over.records === false ? {} : { record: [{ summary: '0-0' }] }) },
    { homeAway: 'away', team: { id: over.awayId ?? '1', abbreviation: 'ATL', location: 'Atlanta', name: 'Hawks', displayName: 'Atlanta Hawks' }, ...(over.records === false ? {} : { record: [{ summary: '0-0' }] }) } ] }] } } } });
const plain = (h: string) => h.replace(/<[^>]+>/g, '');
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, ''); // layout scripts legitimately contain null/undefined
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = () => container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/game/401766458'), params: { id: '401766458' }, locals: { preview: true, league: 'nba' } as App.Locals });

describe('/nba/game/[id] render', () => {
    test('a final game: title with scores, linescore, prior line once, six panels with bodies, breadcrumb', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401766458_processor')) });
        const html = await render();
        expect(plain(html)).toContain('Atlanta 95 @ Orlando 120');
        expect(html).toContain('href="/nba/scoreboard"');
        for (const id of ['wp', 'factors', 'teambox', 'players', 'shots', 'plays']) expect(html).toContain(`id="${id}"`);
        expect(html).toContain('Four factors load here.'); // the panel body renders, not just the id
        expect(html).toMatch(/<th[^>]*>1<\/th>[\s\S]*<th[^>]*>4<\/th>/);
        expect(html.match(/home-court advantage/g)?.length).toBe(1);
        expect(html).not.toContain(' · ');
        const body = noScripts(html);
        for (const bad of ['NaN', 'null', 'undefined']) expect(body).not.toContain(bad);
    });
    test('a null prior renders "no prior" without crashing', async () => {
        prep.mockResolvedValueOnce({ game: { ...fromProcessor(read('game_401766458_processor')), prior: null } });
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
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401766458_api')) });
        const body = noScripts(await render());
        expect(body).toContain('Line: ORL -6');
        expect(body).toContain('(from the spread)');
        expect(body).not.toContain('home-court');
    });
    test('the back link goes to the scoreboard day of the game (Eastern time)', async () => {
        const game = fromProcessor(read('game_401766458_processor'));
        prep.mockResolvedValueOnce({ game: { ...game, date: '2026-10-22T01:00:00Z' } });
        expect(await render()).toContain('href="/nba/scoreboard?date=2026-10-21"');
        prep.mockResolvedValueOnce({ game: { ...game, date: '1990-01-01T00:00:00Z' } });
        const html = await render();
        expect(html).toContain('href="/nba/scoreboard"');
        expect(html).not.toContain('scoreboard?date=1990');
    });
    test('spread 0 is PK; a live game without detail does not print a bare "LIVE - "', async () => {
        const game = fromProcessor(read('game_401766458_processor'));
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
        expect(summary).toHaveBeenLastCalledWith(1, 'nba');
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
});
