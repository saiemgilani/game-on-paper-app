import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CURRENT_YEAR } from '../src/utils/constants';

// #150: /year/<season>?group=<conf> with no week (the picker submitted with only a conference) lands on the
// scoreboard's current week in the current season; a past season, or an explicit type/week, keeps what it had.

const remote: unknown[][] = [];
const board = { calls: [] as unknown[][], events: [] as unknown[], fail: false };
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    getRemoteGames: async (...args: unknown[]) => { remote.push(args); return []; },
    getCurrentScoreboard: async (...args: unknown[]) => {
        board.calls.push(args);
        if (board.fail) throw new Error('ESPN 503');
        return board.events;
    },
}));

const { loadWeek } = await import('../src/routes/week');

const on = (year: number, type: number, week: number) => [{ id: '1', season: { year, type, slug: '' }, week: { number: week } }];

function astro(path: string, params: Record<string, string | undefined>) {
    const cache = { set: vi.fn() };
    return { cache, Astro: { locals: {}, params, url: new URL(`https://gameonpaper.com${path}`), props: {}, cache, response: { headers: new Headers() } } as any };
}

beforeEach(() => {
    remote.length = 0;
    board.calls.length = 0;
    board.events = on(CURRENT_YEAR, 2, 13);
    board.fail = false;
});

describe('loadWeek with no week', () => {
    test('the current season takes the scoreboard week and type, and the conference filter', async () => {
        const { Astro, cache } = astro(`/year/${CURRENT_YEAR}?group=8`, { year: String(CURRENT_YEAR) });
        const out = await loadWeek(Astro, 'cfb');
        expect(out).toMatchObject({ season: CURRENT_YEAR, seasontype: 2, week: 13, group: 8 });
        expect(remote).toEqual([[CURRENT_YEAR, 2, 13, 8, 'cfb']]);
        // the scoreboard page's own read (KV first, write-back on a miss)
        expect(board.calls).toEqual([[true, true, 'cfb']]);
        // the URL's week moves with the scoreboard: held for the scoreboard's window, not a week page's
        expect(cache.set.mock.calls[0][0].tags).toEqual(['week-in-progress']);
    });

    test('the postseason carries its type', async () => {
        board.events = on(CURRENT_YEAR, 3, 1);
        const { Astro } = astro(`/nfl/year/${CURRENT_YEAR}`, { year: String(CURRENT_YEAR) });
        expect(await loadWeek(Astro, 'nfl')).toMatchObject({ seasontype: 3, week: 1, group: undefined });
        expect(board.calls).toEqual([[true, true, 'nfl']]);
    });

    test('a past season keeps week 1 of the regular season and never reads the scoreboard', async () => {
        const { Astro } = astro('/year/2019?group=8', { year: '2019' });
        expect(await loadWeek(Astro, 'cfb')).toMatchObject({ season: 2019, seasontype: 2, week: 1 });
        expect(board.calls).toHaveLength(0);
    });

    test('an explicit type or week is kept as it was', async () => {
        const typed = astro(`/year/${CURRENT_YEAR}/type/3`, { year: String(CURRENT_YEAR), type: '3' });
        expect(await loadWeek(typed.Astro, 'cfb')).toMatchObject({ seasontype: 3, week: 1 });
        const weekly = astro(`/year/${CURRENT_YEAR}/type/2/week/4`, { year: String(CURRENT_YEAR), type: '2', week: '4' });
        expect(await loadWeek(weekly.Astro, 'cfb')).toMatchObject({ seasontype: 2, week: 4 });
        expect(board.calls).toHaveLength(0);
    });

    test.each([
        ['the off-season', on(CURRENT_YEAR, 4, 1)],
        ['the preseason', on(CURRENT_YEAR, 1, 1)],
        ['a scoreboard already on the next season', on(CURRENT_YEAR + 1, 2, 1)],
        ['an empty scoreboard', []],
    ])('%s falls back to week 1', async (_label, events) => {
        board.events = events;
        const { Astro } = astro(`/year/${CURRENT_YEAR}`, { year: String(CURRENT_YEAR) });
        expect(await loadWeek(Astro, 'cfb')).toMatchObject({ seasontype: 2, week: 1 });
    });

    test('a failed scoreboard read falls back to week 1', async () => {
        board.fail = true;
        const { Astro } = astro(`/year/${CURRENT_YEAR}`, { year: String(CURRENT_YEAR) });
        expect(await loadWeek(Astro, 'cfb')).toMatchObject({ seasontype: 2, week: 1 });
    });
});
