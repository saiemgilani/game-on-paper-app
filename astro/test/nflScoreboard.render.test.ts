import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';

// The scoreboard page rendered with locals.league = 'nfl': the title, every
// game link and the header must be the NFL ones, and the season-table nav
// (leaderboards / charts / teams) must be absent until the NFL tables exist.

function competitor(id: string, abbr: string, location: string, score: string) {
    return {
        id, score,
        team: { id, abbreviation: abbr, location, color: '000000' },
        curatedRank: { current: 99 },
        records: [],
    };
}

function finalEvent(id: string) {
    const status = { period: 4, clock: 0, type: { id: '3', name: 'STATUS_FINAL', completed: true, detail: 'Final', shortDetail: 'Final' } };
    return {
        id, date: '2025-11-07T01:15Z', status,
        competitions: [{ id, date: '2025-11-07T01:15Z', status, notes: [], competitors: [competitor('7', 'DEN', 'Denver', '10'), competitor('13', 'LV', 'Las Vegas', '7')] }],
    };
}

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

describe('SchedulePage renders the NFL scoreboard', () => {
    let html = '';
    beforeAll(async () => {
        const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
        html = await container.renderToString(SchedulePage, {
            props: { title: 'NFL | Game on Paper', season: 2025, week: 10, seasontype: 2, isScoreboard: true, games: [finalEvent('401772944')] },
            request: new Request('https://gameonpaper.com/nfl'),
            locals: { league: 'nfl' },
        });
    }, 60_000);

    test('title and description name the league', () => {
        expect(html).toContain('<title>NFL | Game on Paper</title>');
        expect(html).toContain('Live nfl scoreboard');
        // the only "College Football" left is the switcher's title attribute
        expect(html).not.toContain('College Football | Game on Paper');
        expect(html).not.toContain('college football scoreboard');
        expect(html).toContain('Switch to College Football');
    });

    test('game links and the brand link carry the /nfl prefix', () => {
        expect(html).toContain('href="/nfl/game/401772944"');
        expect(html).not.toContain('href="/game/401772944"');
        expect(html).toContain('href="/nfl"');
        expect(html).toContain('https://gameonpaper.com/nfl'); // canonical from the original path
    });

    test('season-table nav is hidden, weeks and the switch to cfb are offered', () => {
        expect(html).not.toContain('/teams/differential');
        expect(html).not.toContain('/charts/builder');
        expect(html).toContain('/nfl/year/2025/type/2/week/1"');
        expect(html).toMatch(/league-switch[^>]*href="\/"|href="\/"[^>]*league-switch/);
    });
});
