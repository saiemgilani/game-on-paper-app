import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { scoreboardGroupOf, trimScoreboardEvents } from '../../src/nba/scoreboard';

const fix = (n: string) => readFileSync(new URL(`../fixtures/mbb/${n}.json`, import.meta.url)).toString();
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

const G = BASKETBALL.mbb.scoreboardGroups!;

describe('?group= (Decision 1)', () => {
    test('top25 is the default and sends no ESPN group; all is 50; a conference is its own id', () => {
        for (const raw of [null, '', 'top25']) expect(scoreboardGroupOf(G, raw)).toEqual({ key: 'top25', espn: null, label: 'Top 25' });
        expect(scoreboardGroupOf(G, 'all')).toEqual({ key: 'all', espn: '50', label: 'Division I' });
        expect(scoreboardGroupOf(G, '8')).toEqual({ key: '8', espn: '8', label: 'Big 12' });
    });
    test("anything else is not a group: ESPN's raw 50, an unknown id, junk", () => {
        for (const raw of ['50', '99', '-1', 'top 25', 'TOP25', '8&x=1', '<b>']) expect(scoreboardGroupOf(G, raw), raw).toBeNull();
    });
    test("the selector's choices are ESPN's own dropdown on the real board", () => {
        const opts = JSON.parse(fix('scoreboard-20250222-all')).content.altSbDropdown.options.map((o: any) => [o.data.group, o.label]);
        expect([['50', 'Division I'], ...G.conferences.map((c) => [c.id, c.label])]).toEqual(opts);
    });
});

describe('getScoreboardForDay with a group (real bodies)', () => {
    const body = (n: string) => new Response(fix(n), { status: 200, headers: { 'content-type': 'application/json' } });
    test('a dated D-I day: group=50 on the cdn URL, its own KV key, trimmed events', async () => {
        fetchMock.mockResolvedValueOnce(body('scoreboard-20250222-all'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const r = await getScoreboardForDay('mbb', '20250222', { pastDay: true, oldDay: true, group: '50' });
        expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/cdn\.espn\.com\/core\/mens-college-basketball\/scoreboard\?group=50&xhr=1&date=20250222&\d+$/);
        expect([r.day, r.events.length, r.degraded]).toEqual(['2025-02-22', 131, false]);
        expect([...kv.keys()]).toEqual(['scoreboard-day:mbb:g50:20250222']);
        expect(JSON.parse(kv.get('scoreboard-day:mbb:g50:20250222')!).events[0]).not.toHaveProperty('links');
    });
    test("a live grouped read takes ESPN's day from content.dateParams (the body has no sbData.day)", async () => {
        fetchMock.mockResolvedValueOnce(body('scoreboard-20250222-g8'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const r = await getScoreboardForDay('mbb', null, { group: '8' });
        expect(String(fetchMock.mock.calls[0][0])).toContain('/scoreboard?group=8&xhr=1&');
        expect([r.day, r.events.length, r.degraded]).toEqual(['2025-02-22', 6, false]);
        expect([...kv.keys()].sort()).toEqual(['scoreboard-day:mbb:g8', 'scoreboard-day:mbb:g8:lastgood']);
    });
    test('the Top 25 board is the ungrouped call and key, untrimmed (as the NBA)', async () => {
        fetchMock.mockResolvedValueOnce(body('scoreboard-20250222-top25'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        await getScoreboardForDay('mbb', '20250222', { pastDay: true });
        expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/scoreboard\?xhr=1&date=20250222&\d+$/);
        expect([...kv.keys()]).toEqual(['scoreboard-day:mbb:20250222']);
    });
    test('trimScoreboardEvents keeps everything a card reads', () => {
        const e = JSON.parse(fix('scoreboard-20250222-top25')).content.sbData.events;
        const t = trimScoreboardEvents(e);
        expect(t).toEqual(e); // the fixture is already trimmed: trimming is idempotent and drops nothing the card reads
        for (const c of t[0].competitions[0].competitors) for (const k of ['id', 'homeAway', 'score', 'team', 'curatedRank', 'records', 'leaders']) expect(c, k).toHaveProperty(k);
    });
});
