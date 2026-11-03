// BB-G21: who gets the basketball source tool, and what it asks the processor for. Flag off, or no admin session, must be
// today's reads exactly; admin + 'source-switch' sends `?source=` and renders the compare. The live feed is mocked.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { mockLive, procJson } from './liveSource';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn(), sources = vi.fn();
vi.mock('../../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));
vi.mock('../../src/resources/python', async (orig) => ({ ...(await orig<typeof import('../../src/resources/python')>()), retrieveGameSources: (...a: unknown[]) => sources(...a) }));

const api = () => JSON.parse(readFileSync(new URL('../fixtures/nba/game_401766458_api.json', import.meta.url)).toString());
const ID = '401766458';
const finalPage = () => ({ page: { gameId: Number(ID), gamepackageJSON: { header: procJson().header } }, regressed: false, fetchFailed: false });
function fakeAstro(league: string, search: string, locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: ID }, url: new URL(`https://gameonpaper.com/${league}/game/${ID}${search}`), locals: { ...locals } as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache };
}
const ADMIN = { preview: true, adminAuthed: true };
/** the processor answers by source: ESPN's fixture without one, the mocked live feed with `live` */
const procBySource = () => proc.mockImplementation(async (_id: string, _ttl: number, _lg: string, source?: string) => (source === 'live' ? mockLive() : procJson()));

beforeEach(() => {
    [sched, rows, proc, espn, sources].forEach((f) => f.mockReset());
    sources.mockResolvedValue({ sources: ['espn'], contract_version: '0.1.0', contract_sha: 'abcdef1234567' });
});

describe('prepareBasketballGame: the gate', () => {
    test.each([
        ['flag off, admin', { adminAuthed: true }],
        ['flag on (preview), no admin session', { preview: true }],
    ])('%s: ?source= is never read; an ingested final is the Data API, no processor, no tool', async (_n, locals) => {
        sched.mockResolvedValueOnce(api().schedule[0]); rows.mockResolvedValueOnce(api());
        const { prepareBasketballGame } = await import('../../src/routes/basketball/game');
        const r: any = await prepareBasketballGame(fakeAstro('nba', '?source=live', locals).astro, 'nba');
        expect(r.game.source).toBe('data_api');
        expect(r).not.toHaveProperty('sourceTools');
        expect(proc).not.toHaveBeenCalled(); expect(sources).not.toHaveBeenCalled();
    });
    test.each([
        ['flag off, admin', { adminAuthed: true }],
        ['flag on (preview), no admin session', { preview: true }],
    ])('%s: a processor render sends today\'s request (no source argument)', async (_n, locals) => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(finalPage()); procBySource();
        const { prepareBasketballGame } = await import('../../src/routes/basketball/game');
        const r: any = await prepareBasketballGame(fakeAstro('nba', '?source=live', locals).astro, 'nba');
        expect(proc).toHaveBeenCalledTimes(1);
        expect(proc.mock.calls[0].slice(0, 3)).toEqual([ID, 86400, 'nba']);
        expect(proc.mock.calls[0][3]).toBeUndefined(); // no source: requestProcessor's URL and key are today's (sourceAdmin.test.ts)
        expect(r).not.toHaveProperty('sourceTools');
        expect(r.game).not.toHaveProperty('provenance');
    });
});

describe('prepareBasketballGame: admin + source-switch', () => {
    test.each(['nba', 'wnba', 'mbb', 'wbb'] as const)('%s: ?source=live skips the Data API, reaches the processor and fetches the ESPN side', async (league) => {
        espn.mockResolvedValueOnce(finalPage()); procBySource();
        sources.mockResolvedValue({ sources: ['live', 'espn'], contract_version: '0.1.0', contract_sha: 'abcdef1234567' });
        const { prepareBasketballGame } = await import('../../src/routes/basketball/game');
        const r: any = await prepareBasketballGame(fakeAstro(league, '?source=live', ADMIN).astro, league);
        expect(sched).not.toHaveBeenCalled(); expect(rows).not.toHaveBeenCalled();
        // the source request holds a minute at most (a failover must not stick for a day); the ESPN side is the public request
        expect(proc.mock.calls).toEqual(expect.arrayContaining([[ID, 60, league, 'live'], [ID, 86400, league]]));
        expect(sources).toHaveBeenCalledWith(ID, league);
        expect(r.game.provenance.source).toBe('live');
        expect(r.sourceTools.selected).toBe('live');
        expect(r.sourceTools.sources).toEqual(['live', 'espn']);
        expect(r.sourceTools.espn.plays).toHaveLength(496);
    });
    test('no ?source= on an ingested final: the Data API renders, the tool lists the registry, no compare fetch', async () => {
        sched.mockResolvedValueOnce(api().schedule[0]); rows.mockResolvedValueOnce(api());
        const { prepareBasketballGame } = await import('../../src/routes/basketball/game');
        const r: any = await prepareBasketballGame(fakeAstro('nba', '', ADMIN).astro, 'nba');
        expect(r.game.source).toBe('data_api');
        expect(r.sourceTools).toEqual({ sources: ['espn'], selected: null, espn: null });
        expect(proc).not.toHaveBeenCalled();
    });
    test('?source=espn on an ingested final is the ESPN processor, not the warehouse, with nothing to compare', async () => {
        espn.mockResolvedValueOnce(finalPage()); procBySource();
        const { prepareBasketballGame } = await import('../../src/routes/basketball/game');
        const r: any = await prepareBasketballGame(fakeAstro('nba', '?source=espn', ADMIN).astro, 'nba');
        expect(sched).not.toHaveBeenCalled();
        expect(proc.mock.calls).toEqual([[ID, 60, 'nba', 'espn']]);
        expect(r.game.source).toBe('processor');
        expect(r.sourceTools).toEqual({ sources: ['espn'], selected: 'espn', espn: null });
    });
    test('a registry that cannot answer is ESPN alone; a failed ESPN side is an empty column, not a failed page', async () => {
        espn.mockResolvedValueOnce(finalPage());
        proc.mockImplementation(async (_i: string, _t: number, _l: string, source?: string) => { if (source) return mockLive(); throw new Error('espn side down'); });
        sources.mockResolvedValue(null);
        const { prepareBasketballGame } = await import('../../src/routes/basketball/game');
        const r: any = await prepareBasketballGame(fakeAstro('nba', '?source=live', ADMIN).astro, 'nba');
        expect(r.sourceTools).toEqual({ sources: ['espn'], selected: 'live', espn: null });
        expect(r.game.provenance.source).toBe('live');
    });
});

describe('the tool on the page', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    async function render(locals: Record<string, unknown>, search: string, sourceTools?: unknown, payload = procJson()) {
        const { fromProcessor } = await import('../../src/resources/nbaGame');
        const { default: Page } = await import('../../src/components/nba/game/NbaGamePage.astro');
        return container.renderToString(Page, {
            props: { game: fromProcessor(payload, 'nba'), sourceTools },
            request: new Request(`https://gameonpaper.com/nba/game/${ID}${search}`),
            locals: { league: 'nba', ...locals } as any,
        });
    }
    test('without the tool the page is byte-for-byte today\'s, whatever the URL says', async () => {
        const html = await render({ preview: true }, '?source=live');
        expect(html).not.toContain('data-admin-game-tools');
        expect(html).not.toContain('source-compare');
        expect(html).toBe(await render({ preview: true }, ''));
    });
    test('a stray tool prop without an admin session still renders nothing', async () => {
        const html = await render({ preview: true }, '?source=live', { sources: ['live', 'espn'], selected: 'live', espn: null }, mockLive());
        expect(html).not.toContain('data-admin-game-tools');
        expect(html).not.toContain('source-compare');
    });
    test('ESPN only (today\'s registry): the select and provenance, no compare', async () => {
        const html = await render(ADMIN, '', { sources: ['espn'], selected: null, espn: null });
        expect(html).toContain('data-admin-game-tools');
        // default (the public render) is selected; ESPN asks for the ESPN processor explicitly
        expect(html).toMatch(/<option value="\/nba\/game\/401766458" selected[^>]*>Source: default/);
        expect(html).toMatch(/<option value="\/nba\/game\/401766458\?source=espn"[^>]*>Source: espn/);
        expect(html).not.toContain('Source: live');
        expect(html).not.toContain('data-admin-source-compare');
    });
    test('a mocked live render: the options, the served feed and the compare table', async () => {
        const { fromProcessor } = await import('../../src/resources/nbaGame');
        const html = await render(ADMIN, '?source=live', { sources: ['live', 'espn'], selected: 'live', espn: fromProcessor(procJson(), 'nba') }, mockLive());
        expect(html).toContain('Source: live');
        expect(html).toMatch(/<option value="\/nba\/game\/401766458\?source=live" selected[^>]*>Source: live/);
        expect(html).toMatch(/<option value="\/nba\/game\/401766458\?source=espn"[^>]*>Source: espn/);
        // default clears ?source=: the public render
        expect(html).toMatch(/<option value="\/nba\/game\/401766458"[^>]*>Source: default/);
        expect(html).toContain('Served: live');
        expect(html).toContain('contract abcdef1');
        expect(html).toContain('data-admin-source-compare');
        expect(html).toContain('Plays: 490 against 496');
        expect(html).toContain('-2'); // the home score delta
        expect(html).toContain('eFG%');
    });
    test('a live request ESPN answered (failover) says so', async () => {
        const html = await render(ADMIN, '?source=live', { sources: ['live', 'espn'], selected: 'live', espn: null }, mockLive({ fallback: true }));
        expect(html).toContain('Served: espn (fallback)');
        expect(html).toContain('the ESPN side did not load');
    });
});
