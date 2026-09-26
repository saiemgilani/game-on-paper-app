import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadGzJson } from './helpers/tables';

// Real, offline /process payloads (fixtures/README.md): CMU at OKST 2016, JAX at CLE 2026.
const FIXTURES = { cfb: 'usage-cfb-400869270.json.gz', nfl: 'usage-nfl-401872922.json.gz' } as const;

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function renderHeader(league: 'cfb' | 'nfl', on: boolean) {
    const game = loadGzJson(FIXTURES[league]);
    const { default: GameHeader } = await import('../src/components/game/GameHeader.astro');
    const html = await container.renderToString(GameHeader, {
        props: { game },
        locals: { league, flagOverrides: { 'game-links': on } } as any,
    });
    return { html, game };
}
const h1s = (html: string) => [...html.matchAll(/<h1[\s\S]*?<\/h1>/g)].map((m) => m[0]);

describe('game-links: the header text links into the site', () => {
    for (const league of ['cfb', 'nfl'] as const) {
        const prefix = league === 'nfl' ? '/nfl' : '';
        test(`[${league}] flag on: both h1s link both teams, Back goes to the game's week`, async () => {
            const { html, game } = await renderHeader(league, true);
            const heads = h1s(html);
            expect(heads).toHaveLength(2); // the desktop and the phone header
            for (const h of heads) {
                expect(h).toContain(`href="${prefix}/team/${game.teamInfo.away.id}"`);
                expect(h).toContain(`href="${prefix}/team/${game.teamInfo.home.id}"`);
            }
            const { year, type } = game.header.season;
            const week = `href="${prefix}/year/${year}/type/${type}/week/${game.header.week}"`;
            expect(html.split(week).length - 1).toBe(2); // both Back buttons
        });
        test(`[${league}] flag off: the header the public gets today`, async () => {
            const { html } = await renderHeader(league, false);
            for (const h of h1s(html)) expect(h).not.toContain('href=');
            expect(html.split(`href="${prefix || '/'}"`).length - 1).toBe(2);
            expect(html).not.toContain('/team/');
        });
    }
});
