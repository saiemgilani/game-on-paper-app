import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const sbDay = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sbDay(...a) }));
import { prepareBasketballScoreboard, TOP25_FALLBACK_NOTE } from '../../src/routes/basketball/scoreboard';

const events = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
const astro = (q: string) => ({ params: {}, url: new URL(`https://gameonpaper.com/mbb/scoreboard${q}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } } as any);
beforeEach(() => { sbDay.mockReset(); });

describe('the loader validates group before any upstream call', () => {
    test('?group=99 and ?group=50 are 400s with no ESPN read; ?group=8 passes 8 to both reads', async () => {
        sbDay.mockResolvedValue({ day: '2025-02-22', events: [], degraded: false });
        for (const q of ['?group=99', '?group=50', '?date=2025-02-22&group=x']) expect(await prepareBasketballScoreboard(astro(q), 'mbb'), q).toEqual({ badDate: 'group' });
        expect(sbDay).not.toHaveBeenCalled();
        const r = await prepareBasketballScoreboard(astro('?date=2025-02-21&group=8'), 'mbb');
        expect(sbDay.mock.calls.map((c) => [c[1], (c[2] as any)?.group])).toEqual([[null, '8'], ['20250221', '8']]);
        expect(r).toMatchObject({ group: '8', groupLabel: 'Big 12' });
        sbDay.mockReset();
        // a Top 25 day with games (an empty one would add the D35 D-I read, tested below)
        sbDay.mockResolvedValue({ day: '2025-02-22', events: events('20250222-top25'), degraded: false });
        await prepareBasketballScoreboard(astro('?date=2025-02-21'), 'mbb');
        expect(sbDay.mock.calls.map((c) => c.length === 3 ? (c[2] as any).group : 'none')).toEqual(['none', undefined]); // Top 25: no group in either call
    });
    test('D35: an empty Top 25 day reads the D-I board for the same day and says so; a non-empty one does not', async () => {
        const all = events('20250406-all');
        sbDay.mockImplementation(async (_lg, _d, o) => ({ day: '2025-04-06', events: (o as any)?.group === '50' ? all : [], degraded: false }));
        const r: any = await prepareBasketballScoreboard(astro('?date=2025-04-06'), 'mbb');
        expect(TOP25_FALLBACK_NOTE).toBe('No ranked teams play today — showing all Division I');
        expect([r.games.length, r.group, r.fallbackNote]).toEqual([1, 'top25', TOP25_FALLBACK_NOTE]);
        const last = sbDay.mock.calls.at(-1)!;
        expect([last[1], (last[2] as any)?.group]).toEqual(['20250406', '50']); // the same day, all of D-I
        sbDay.mockReset();
        sbDay.mockImplementation(async () => ({ day: '2025-04-06', events: [], degraded: false }));
        const empty: any = await prepareBasketballScoreboard(astro('?date=2025-04-06'), 'mbb'); // D-I empty too: no note, "No games scheduled."
        expect([empty.games.length, empty.fallbackNote]).toEqual([0, undefined]);
        sbDay.mockClear();
        const conf: any = await prepareBasketballScoreboard(astro('?date=2025-04-06&group=8'), 'mbb'); // an explicit group never falls back
        expect(sbDay.mock.calls.some((c) => (c[2] as any)?.group === '50')).toBe(false);
        expect(conf.fallbackNote).toBeUndefined();
        const ranked = events('20250222-top25');
        sbDay.mockReset();
        sbDay.mockImplementation(async (_lg, _d, o) => ({ day: '2025-02-22', events: (o as any)?.group === '50' ? all : ranked, degraded: false }));
        const top25: any = await prepareBasketballScoreboard(astro('?date=2025-02-22'), 'mbb'); // a non-empty Top 25 day: no D-I read, no note
        expect([top25.games.length, top25.fallbackNote, sbDay.mock.calls.some((c) => (c[2] as any)?.group === '50')]).toEqual([15, undefined, false]);
    });
    test('D35 failed fallback: an empty Top 25 day whose D-I read degraded is uncacheable, degraded and carries no note', async () => {
        const run = async (degraded: boolean) => {
            const a = astro('?date=2025-04-06');
            const set = vi.fn();
            a.cache.set = set;
            sbDay.mockReset();
            sbDay.mockImplementation(async (_lg, _d, o) => ({ day: '2025-04-06', events: [], degraded: (o as any)?.group === '50' && degraded }));
            const r: any = await prepareBasketballScoreboard(a, 'mbb');
            expect(sbDay.mock.calls.some((c) => (c[2] as any)?.group === '50')).toBe(true); // the D-I read happened
            return { r, set, cc: a.response.headers.get('Cache-Control') };
        };
        const failed = await run(true);
        expect([failed.r.games.length, failed.r.fallbackNote, failed.r.degraded]).toEqual([0, undefined, true]); // degraded: the page says unavailable, not "No games scheduled."
        expect(failed.set).toHaveBeenCalledWith(false);
        expect(failed.cc).toBe('no-store');
        const ok = await run(false); // the same empty day with a D-I read that succeeded (and was empty) is cached
        expect(ok.set).not.toHaveBeenCalledWith(false);
        expect(ok.cc).toBeNull();
        expect(ok.r.degraded).toBe(false);
    });
    test('the NBA and WNBA params carry no group keys', async () => {
        sbDay.mockResolvedValue({ day: '2025-02-22', events: [], degraded: false });
        for (const lg of ['nba', 'wnba'] as const) {
            const r: any = await prepareBasketballScoreboard(astro('?date=2025-02-21&group=8'), lg);
            expect(Object.keys(r).filter((k) => /group|fallback/i.test(k)), lg).toEqual([]);
        }
        expect(sbDay.mock.calls.every((c) => !(c[2] as any)?.group)).toBe(true);
    });
});
