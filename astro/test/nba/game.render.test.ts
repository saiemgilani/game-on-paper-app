import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/nba/game', () => ({ prepareNbaGame: (...a: unknown[]) => prep(...a) }));
import Page from '../../src/pages/nba/game/[id].astro';
import { fromProcessor } from '../../src/resources/nbaGame';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, ''); // layout scripts legitimately contain null/undefined
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = () => container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/game/401766458'), params: { id: '401766458' }, locals: { preview: true, league: 'nba' } as App.Locals });

describe('/nba/game/[id] render', () => {
    test('a final game: title with scores, linescore, prior line once, six panels with bodies, breadcrumb', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401766458_processor')) });
        const html = await render();
        expect(html).toContain('Atlanta 95 @ Orlando 120');
        expect(html).toContain('href="/nba/scoreboard"');
        for (const id of ['wp', 'factors', 'teambox', 'players', 'shots', 'plays']) expect(html).toContain(`id="${id}"`);
        expect(html).toContain('Four factors load here.'); // the panel body renders, not just the id
        expect(html).toMatch(/<th[^>]*>1<\/th>[\s\S]*<th[^>]*>4<\/th>/);
        expect(html.match(/home-court advantage/g)?.length).toBe(1);
        expect(html).not.toContain(' · ');
        const body = noScripts(html);
        for (const bad of ['NaN', 'null', 'undefined']) expect(body).not.toContain(bad);
    });
    test('a null prior renders "No prior" without crashing', async () => {
        prep.mockResolvedValueOnce({ game: { ...fromProcessor(read('game_401766458_processor')), prior: null } });
        const html = await render();
        expect(html).toContain('No prior');
        expect(noScripts(html)).not.toContain('undefined');
    });
    test('a pregame renders teams, records, broadcast from media.shortName and no panels', async () => {
        prep.mockResolvedValueOnce({ pregame: true, espnGame: { gameId: 1, gamepackageJSON: { header: { competitions: [{ date: '2026-10-21T23:00Z', status: { type: { name: 'STATUS_SCHEDULED', completed: false, description: 'Scheduled', detail: '10/21 - 7:00 PM EDT' } }, broadcasts: [{ media: { shortName: 'ESPN' } }], competitors: [
            { homeAway: 'home', team: { id: '19', abbreviation: 'ORL', location: 'Orlando', name: 'Magic', displayName: 'Orlando Magic' }, record: [{ summary: '0-0' }] },
            { homeAway: 'away', team: { id: '1', abbreviation: 'ATL', location: 'Atlanta', name: 'Hawks', displayName: 'Atlanta Hawks' }, record: [{ summary: '0-0' }] } ] }], season: { year: 2027, type: 2 } } } } });
        const html = await render();
        expect(html).toContain('Atlanta @ Orlando');
        expect(html).toContain('ESPN');
        expect(html).toContain('ATL 0-0, ORL 0-0');
        expect(html).not.toContain('id="wp"');
    });
});
