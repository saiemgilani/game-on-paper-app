/**
 * The play focus bar carries the reading-order toggle again (review on #270).
 *
 * The quarter filter bar it replaced had a "Newest first / Oldest first" button;
 * dropping it left a live game stuck newest first and a final stuck in order.
 * The click itself is driven in scripts/walkthroughs/play-order.mjs; here the
 * button's starting state is read off the rendered markup, on a real game.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadGzJson } from './helpers/tables';

const g = loadGzJson('game-401729745.json.gz');
const periods = [...new Set(g.plays.map((p: any) => Number(p.period)))].filter((p) => p > 0).sort((a, b) => a - b);

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

const render = async (newestFirst: boolean) => {
    const { default: PlayFocus } = await import('../src/components/game/plays/PlayFocus.astro');
    return container.renderToString(PlayFocus, {
        props: { target: 'all', plays: g.plays, periods, teams: g.advBoxScore.team.map((t: any) => t.pos_team), newestFirst },
    });
};
const toggleOf = (html: string) => html.match(/<button\b[^>]*data-order-toggle[^>]*>([\s\S]*?)<\/button>/);

describe('the play order toggle', () => {
    test('a finished game reads in order, and the button says so', async () => {
        const m = toggleOf(await render(false));
        expect(m, 'one order toggle in the bar').toBeTruthy();
        expect(m![0]).toContain('aria-pressed="false"');
        expect(m![1].trim()).toBe('Oldest first');
    }, 60_000);

    test('a live game reads newest first', async () => {
        const m = toggleOf(await render(true));
        expect(m![0]).toContain('aria-pressed="true"');
        expect(m![1].trim()).toBe('Newest first');
    }, 60_000);

    test('the toggle sits in the same bar as the focus menu', async () => {
        const html = await render(false);
        const bar = html.match(/<div\b[^>]*data-play-focus="all"[\s\S]*?<\/div>/)?.[0] ?? '';
        expect(bar).toContain('id="focus-all"');
        expect(bar).toContain('data-order-toggle');
    }, 60_000);
});
