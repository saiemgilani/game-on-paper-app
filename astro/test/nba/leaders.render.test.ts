// test/nba/leaders.render.test.ts
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { PlayerGameRow } from '../../src/resources/nbaShots';
import { seasonPlayerRows } from './rows';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const byPlayer = read('player_games') as Record<string, any[]>;
const state = { empty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => seasonPlayerRows(),
    retrieveSeasonPlayerGameRows: async (): Promise<PlayerGameRow[]> => state.empty ? [] : Object.entries(byPlayer).flatMap(([pid, games]) => games.map((g) => ({
        season: 2026, person_id: Number(pid), game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    }))),
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function render(query = '') {
    const { default: Page } = await import('../../src/pages/nba/leaders.astro');
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/nba/leaders${query}`), locals: { preview: true } as App.Locals });
}

describe('/nba/leaders', () => {
    test('one h1, the season picker, the boards island with the default window and board', async () => {
        const html = await render('?season=2026');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        expect(html).toContain('Rolling leaders, 2025-26');
        expect(html).toContain('id="nba-season"');
        expect(html).toContain('id="nba-leaders"');
        expect(html).toContain('players qualify');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('a season without game logs says so instead of rendering boards', async () => {
        state.empty = true;
        try {
            const html = await render('?season=2026');
            expect(html).toContain('no game logs');
            expect(html).not.toContain('id="nba-leaders"');
            expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        } finally { state.empty = false; }
    });
});
