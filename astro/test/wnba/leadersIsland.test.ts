// astro/test/wnba/leadersIsland.test.ts
// @vitest-environment jsdom
// The leaders island with no featured team and the WNBA pronoun, on the real 2026 game rows.
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, test } from 'vitest';
import Leaderboards from '../../src/components/nba/Leaderboards.svelte';
import BoardSelectLeaderboards from '../../src/components/nba/BoardSelectLeaderboards.svelte';
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
    test('BB-G11 movers: five boards in a select, Most declined ranked from the largest drop, the definition always shown', () => {
        const boards = leaderBoards(seasonPlayerGamesFromRows(playerGames2026(), seasonPlayers(2026)), null, 15, { fga: 4, fg3a: 2 }, { movers: true });
        const target = document.createElement('div');
        document.body.appendChild(target);
        const c = mount(BoardSelectLeaderboards, { target, props: { boards, netsTeamId: null, seasonQuery: '', pronoun: 'her', bars: { fga: 4, fg3a: 2 }, league: 'wnba', movers: true } });
        flushSync();
        expect(target.textContent).toContain("The change: the window's eFG% minus her season eFG% to date");
        expect(target.querySelector('[aria-label="Board"]')!.className).toBe('d-none');
        const select = target.querySelector('select')!;
        expect(select.id).toBe('leaders-board');
        expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['FG%', 'eFG%', '3P%', 'Most improved', 'Most declined']);
        expect(select.value).toBe('efgPct');
        select.value = 'declined';
        select.dispatchEvent(new Event('change'));
        flushSync();
        const heads = [...target.querySelectorAll('#nba-leaders thead th')].map((th) => th.textContent);
        expect(heads).toEqual(['#', 'Player', 'Team', 'eFG% change', 'FGM/FGA', 'Season eFG%', 'Window']);
        const first = target.querySelector('#nba-leaders tbody tr')!;
        expect(first.querySelectorAll('td')[3].textContent).toMatch(/^−\d+\.\d pts$/);
        expect(first.querySelectorAll('td')[3].textContent).toBe(`−${Math.abs(boards[10].declined!.rows[0].value * 100).toFixed(1)} pts`);
        unmount(c);
        target.remove();
    });
});
