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

// #333: teams new to FBS in 2026 were missing from both team selects. The
// builder lists every team in the static index (static/teams.json), and that
// index's 2026 refresh only appended 2026 to teams already in it, so a program
// with no earlier FBS season never got a row. Both are FBS in 2026 in the
// Data API's team_summaries, ESPN's group 80 and the 2026 schedule.
describe('MatchupBuilder lists 2026 FBS newcomers (#333)', () => {
    const newcomers = [
        { team_id: 16, name: 'Sacramento State' },
        { team_id: 2449, name: 'North Dakota State' },
    ];

    test('the cfb team index carries each newcomer with its 2026 season', async () => {
        const { retrieveAllTeams } = await import('../src/utils/teams');
        const teams = retrieveAllTeams('cfb');
        for (const n of newcomers) {
            const hit = teams.find((t) => t.team_id === n.team_id);
            expect(hit?.name).toBe(n.name);
            expect(hit?.seasons).toContain(2026);
        }
    });

    test('a newcomer is selectable, and selected it offers its 2026 season', async () => {
        const { retrieveAllTeams } = await import('../src/utils/teams');
        const { default: MatchupBuilder } = await import('../src/components/game/MatchupBuilder.svelte');
        const html = await container.renderToString(MatchupBuilder, {
            props: {
                teamSeasons: retrieveAllTeams('cfb'), league: 'cfb', projection: null,
                awayTeamId: '16', awaySeason: '2026', homeTeamId: '2449', homeSeason: '2026',
            },
        });
        // each <select> on its own: [away team, away season, home team, home season]
        const selects = [...html.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)].map((m) => m[1]);
        expect(selects).toHaveLength(4);
        const option = (sel: string, value: string | number, label: string) =>
            new RegExp(`<option(?![^>]*\\bdisabled\\b)[^>]*value="${value}"(?![^>]*\\bdisabled\\b)[^>]*>${label}</option>`).test(sel);
        const selected = (sel: string, value: string | number) =>
            new RegExp(`<option(?![^>]*\\bdisabled\\b)(?=[^>]*value="${value}")(?=[^>]*\\bselected\\b)[^>]*>`).test(sel);
        [selects[0], selects[2]].forEach((sel, i) => {
            expect(option(sel, newcomers[i].team_id, newcomers[i].name)).toBe(true);
            expect(selected(sel, newcomers[i].team_id)).toBe(true);
        });
        // both season selects offer 2026 selected, none of it disabled
        expect(selected(selects[1], 2026)).toBe(true);
        expect(selected(selects[3], 2026)).toBe(true);
    });
});
