import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { scoreboardGroupOf, trimScoreboardEvents } from '../../src/nba/scoreboard';

const fix = (n: string) => readFileSync(new URL(`../fixtures/wbb/${n}.json`, import.meta.url)).toString();
const kv = new Map<string, string>();
const fetchMock = vi.fn();
vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')
        ? { get: async (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!) : null), put: async (key: string, value: string) => { kv.set(key, value); },
            getWithMetadata: async () => ({ value: null, metadata: null }) }
        : undefined) }),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), wrappedFetch: (...a: unknown[]) => fetchMock(...a) }));
beforeEach(() => { kv.clear(); fetchMock.mockReset(); });

const G = BASKETBALL.wbb.scoreboardGroups!;

describe("?group= on the women's board (Decision 1)", () => {
    test('top25 is the default and sends no ESPN group; all is 50; a conference is its own women\'s id', () => {
        for (const raw of [null, '', 'top25']) expect(scoreboardGroupOf(G, raw)).toEqual({ key: 'top25', espn: null, label: 'Top 25' });
        expect(scoreboardGroupOf(G, 'all')).toEqual({ key: 'all', espn: '50', label: 'Division I' });
        expect(scoreboardGroupOf(G, '8')).toEqual({ key: '8', espn: '8', label: 'Big 12' });
        expect(scoreboardGroupOf(G, '47')).toEqual({ key: '47', espn: '47', label: 'Summit' });
    });
    test("anything else is not a group: ESPN's raw 50, the men's Summit id 49, an unknown id, junk", () => {
        for (const raw of ['50', '49', '99', '-1', 'top 25', 'TOP25', '8&x=1', '<b>']) expect(scoreboardGroupOf(G, raw), raw).toBeNull();
    });
    test("the selector's choices are ESPN's own women's dropdown on the real board", () => {
        const opts = JSON.parse(fix('scoreboard-20260207-all')).content.altSbDropdown.options.map((o: any) => [o.data.group, o.label]);
        expect([['50', 'Division I'], ...G.conferences.map((c) => [c.id, c.label])]).toEqual(opts);
    });
});

describe('getScoreboardForDay with a group (real women\'s bodies)', () => {
    const body = (n: string) => new Response(fix(n), { status: 200, headers: { 'content-type': 'application/json' } });
    test('a dated D-I day: group=50 on the women\'s cdn URL, its own KV key, trimmed events', async () => {
        fetchMock.mockResolvedValueOnce(body('scoreboard-20260207-all'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const r = await getScoreboardForDay('wbb', '20260207', { pastDay: true, oldDay: true, group: '50' });
        expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/cdn\.espn\.com\/core\/womens-college-basketball\/scoreboard\?group=50&xhr=1&date=20260207&\d+$/);
        expect([r.day, r.events.length, r.degraded]).toEqual(['2026-02-07', 138, false]);
        expect([...kv.keys()]).toEqual(['scoreboard-day:wbb:g50:20260207']);
    });
    test("a live grouped read takes ESPN's day from content.dateParams (the body has no sbData.day)", async () => {
        fetchMock.mockResolvedValueOnce(body('scoreboard-20260207-g8'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const r = await getScoreboardForDay('wbb', null, { group: '8' });
        expect(String(fetchMock.mock.calls[0][0])).toContain('/womens-college-basketball/scoreboard?group=8&xhr=1&');
        expect([r.day, r.events.length, r.degraded]).toEqual(['2026-02-07', 7, false]);
        expect([...kv.keys()].sort()).toEqual(['scoreboard-day:wbb:g8', 'scoreboard-day:wbb:g8:lastgood']);
    });
    test('the Top 25 board is the ungrouped call and key', async () => {
        fetchMock.mockResolvedValueOnce(body('scoreboard-20260207-top25'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        await getScoreboardForDay('wbb', '20260207', { pastDay: true });
        expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/womens-college-basketball\/scoreboard\?xhr=1&date=20260207&\d+$/);
        expect([...kv.keys()]).toEqual(['scoreboard-day:wbb:20260207']);
    });
    test('trimScoreboardEvents is idempotent on the trimmed women\'s fixture', () => {
        const e = JSON.parse(fix('scoreboard-20260207-top25')).content.sbData.events;
        expect(trimScoreboardEvents(e)).toEqual(e);
    });
});
