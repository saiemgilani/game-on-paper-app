import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';

// The builder's "we found a game" alert linked ONE game, which is wrong for any
// pair that met more than once in a season -- every NFL division matchup, plus
// anyone who meets again in the postseason.
let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const projection = {
    winner: '2025 Atlanta Falcons', team_id: '1', margin: 3.2, win_prob: 0.58,
    actual_games: [
        { game_id: 401772838, label: 'Week 3: ATL 0-30 CAR' },
        { game_id: 401772882, label: 'Week 11: CAR 30-27 ATL' },
    ],
};

const render = async (games: typeof projection.actual_games) => {
    const { default: MatchupBuilder } = await import('../src/components/game/MatchupBuilder.svelte');
    return container.renderToString(MatchupBuilder, {
        props: { teamSeasons: [], league: 'nfl', projection: { ...projection, actual_games: games } },
    });
};

describe('MatchupBuilder links every meeting', () => {
    test('two meetings render as a labelled list, both linked', async () => {
        const html = await render(projection.actual_games);
        expect(html).toContain('2 meetings that season');
        expect(html).toContain('href="/nfl/game/401772838"');
        expect(html).toContain('href="/nfl/game/401772882"');
        expect(html).toContain('Week 3: ATL 0-30 CAR');
        expect(html).toContain('Week 11: CAR 30-27 ATL');
    });

    test('one meeting keeps the single-link alert', async () => {
        const html = await render([projection.actual_games[0]]);
        expect(html).toContain('We found a game for this matchup!');
        expect(html).toContain('href="/nfl/game/401772838"');
        expect(html).not.toContain('meetings that season');
    });

    test('no completed meeting shows no alert at all', async () => {
        const html = await render([]);
        expect(html).not.toContain('We found a game');
        expect(html).not.toContain('meetings that season');
        expect(html).toContain('Projected Winner');
    });
});
