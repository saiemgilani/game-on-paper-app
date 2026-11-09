// astro/test/wbb/leadersIsland.test.ts
// @vitest-environment jsdom
// The leaders island with the WBB windows and the window note, on the real 2026 49-day read.
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, test } from 'vitest';
import Leaderboards from '../../src/components/nba/Leaderboards.svelte';
import { BASKETBALL } from '../../src/basketball/config';
import { seasonLinesFromRows, seasonPlayerGamesFromRows } from '../../src/nba/adapters';
import { leaderBoards } from '../../src/nba/data/leaders';
import { leadersGames2026, seasonPlayers } from './dashboardFixtures';

describe('Leaderboards with the WBB windows', () => {
    test('two window buttons, the note, no Nets, WBB player links', () => {
        const players = seasonPlayers(2026);
        const boards = leaderBoards(seasonPlayerGamesFromRows(leadersGames2026(), players), null, 15, BASKETBALL.wbb.leaderBars(2026), { windows: [5, 10], seasonLines: seasonLinesFromRows(players) });
        const target = document.createElement('div');
        document.body.appendChild(target); // appendChild: the workers types shadow ParentNode.append
        const windowNote = ' Windows count games from Feb 16 on: the last 49 days of games.';
        const c = mount(Leaderboards, { target, props: { boards, netsTeamId: null, seasonQuery: '', windows: [5, 10], windowNote, league: 'wbb', bars: { fga: 3, fg3a: 2 }, pronoun: 'her' } });
        expect([...target.querySelectorAll('[aria-label="Window"] button')].map((b) => b.textContent)).toEqual(['5 games', '10 games']);
        expect(target.textContent).toContain('players qualify. Windows count games from Feb 16 on: the last 49 days of games.');
        [...target.querySelectorAll('button')].find((b) => b.textContent === '5 games')!.click();
        flushSync();
        expect(target.querySelectorAll('#nba-leaders tbody tr').length).toBeGreaterThan(0);
        expect(target.textContent).toContain('15+ FGA in it');
        expect(target.querySelector('#nba-leaders tbody a')!.getAttribute('href')).toMatch(/^\/wbb\/players\//);
        [...target.querySelectorAll('button')].find((b) => b.textContent === 'Most improved')!.click();
        flushSync();
        expect(target.textContent).toContain('minus her season eFG%');
        expect(target.textContent).not.toMatch(/Nets|\bhis\b/);
        unmount(c);
        target.remove();
    });
});
