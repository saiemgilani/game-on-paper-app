// astro/test/wnba/leadersIsland.test.ts
// @vitest-environment jsdom
// The leaders island with no featured team and the WNBA pronoun, on the real 2026 game rows.
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, test } from 'vitest';
import Leaderboards from '../../src/components/nba/Leaderboards.svelte';
import { seasonPlayerGamesFromRows } from '../../src/nba/adapters';
import { leaderBoards } from '../../src/nba/data/leaders';
import { playerGames2026, seasonPlayers } from './dashboardFixtures';

describe('Leaderboards without a featured team', () => {
    test('no Nets anywhere, "her season eFG%" on Most improved', () => {
        const boards = leaderBoards(seasonPlayerGamesFromRows(playerGames2026(), seasonPlayers(2026)), null);
        for (const n of [5, 10, 20] as const) expect(boards[n].efgPct.also).toEqual([]);
        const target = document.createElement('div');
        document.body.appendChild(target); // appendChild: the workers types shadow ParentNode.append
        const c = mount(Leaderboards, { target, props: { boards, netsTeamId: null, seasonQuery: '', pronoun: 'her', bars: { fga: 4, fg3a: 2 } } });
        expect(target.querySelectorAll('#nba-leaders tbody tr').length).toBeGreaterThanOrEqual(15);
        const m = target.textContent!.match(/a full (\d+)-game window\), (\d+)\+ FGA in it/)!;
        expect(Number(m[2])).toBe(4 * Number(m[1])); // D31: 4 FGA a game in the window, not the NBA's 5
        expect(target.querySelectorAll('tr.fw-bold')).toHaveLength(0);
        [...target.querySelectorAll('button')].find((b) => b.textContent === 'Most improved')!.click();
        flushSync();
        expect(target.textContent).toContain('minus her season eFG%');
        expect(target.textContent).not.toMatch(/Nets/);
        unmount(c);
        target.remove();
    });
});
