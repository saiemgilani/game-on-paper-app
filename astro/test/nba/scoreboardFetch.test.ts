import { beforeEach, describe, expect, test, vi } from 'vitest';

const kv = new Map<string, { value: string; ttl?: number }>();
const fetchMock = vi.fn();
let kvFail = false;
vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')
        ? { get: async (key: string, _t?: string) => { if (kvFail) throw new Error('kv down'); return (kv.has(key) ? JSON.parse(kv.get(key)!.value) : null); },
            getWithMetadata: async (key: string) => { if (kvFail) throw new Error('kv down'); return (kv.has(key) ? { value: JSON.parse(kv.get(key)!.value), metadata: { fetchedAt: Date.now() } } : { value: null }); },
            put: async (key: string, value: string, opts?: { expirationTtl?: number }) => { kv.set(key, { value, ttl: opts?.expirationTtl }); } }
        : undefined) }),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), wrappedFetch: (...a: unknown[]) => fetchMock(...a) }));

const payload = (day: string, ids: string[]) => new Response(JSON.stringify({ content: { sbData: { day: { date: day }, events: ids.map((id) => ({ id, date: `${day}T23:00Z`, competitions: [{ competitors: [] }], status: { type: { name: 'STATUS_SCHEDULED' } } })) } } }), { status: 200 });

beforeEach(() => { kv.clear(); fetchMock.mockReset(); kvFail = false; });

describe('getScoreboardForDay', () => {
    test('live reads ESPN once, caches {day, events} under its own key and a last-good copy', async () => {
        fetchMock.mockResolvedValueOnce(payload('2026-10-10', ['1', '2']));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const a = await getScoreboardForDay('nba', null);
        expect(a).toEqual({ day: '2026-10-10', events: expect.any(Array), degraded: false });
        expect(a.events).toHaveLength(2);
        expect(kv.has('scoreboard-day:nba') && kv.has('scoreboard-day:nba:lastgood')).toBe(true);
        // never the array-valued keys getCurrentScoreboard owns
        expect(kv.has('scoreboard:nba') || kv.has('scoreboard:nba:lastgood')).toBe(false);
        const b = await getScoreboardForDay('nba', null);
        expect(b.day).toBe('2026-10-10');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/core/nba/scoreboard?xhr=1');
        expect(String(fetchMock.mock.calls[0][0])).not.toContain('date=');
    });
    test('a dated day uses its own key for a day and never writes the live key', async () => {
        fetchMock.mockResolvedValueOnce(payload('2025-04-15', ['9']));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const r = await getScoreboardForDay('nba', '20250415', { pastDay: true });
        expect(r).toEqual({ day: '2025-04-15', events: expect.any(Array), degraded: false });
        expect(String(fetchMock.mock.calls[0][0])).toContain('date=20250415');
        expect(kv.get('scoreboard-day:nba:20250415')?.ttl).toBe(86400);
        expect(kv.has('scoreboard-day:nba')).toBe(false);
        expect(kv.has('scoreboard:nba')).toBe(false);
    });
    test('ESPN failure: live serves last-good, a dated day is degraded and uncached', async () => {
        kv.set('scoreboard-day:nba:lastgood', { value: JSON.stringify({ day: '2026-10-09', events: [{ id: 'old' }] }) });
        fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const live = await getScoreboardForDay('nba', null);
        expect(live).toEqual({ day: '2026-10-09', events: [{ id: 'old' }], degraded: false, stale: true });
        const dated = await getScoreboardForDay('nba', '20250415');
        expect(dated).toEqual({ day: '2025-04-15', events: [], degraded: true });
        expect(kv.has('scoreboard-day:nba:20250415')).toBe(false);
    });
});

describe('getScoreboardForDay hardening', () => {
    const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    test('live: a 200 with no body.day is never cached and never uses the server clock', async () => {
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        fetchMock.mockResolvedValueOnce(body({}));
        expect(await getScoreboardForDay('nba', null)).toMatchObject({ events: [], degraded: true });
        fetchMock.mockResolvedValueOnce(body({ content: { sbData: { events: [{ id: '1' }] } } }));
        const r = await getScoreboardForDay('nba', null);
        expect(r).toMatchObject({ events: [], degraded: true });
        expect(kv.size).toBe(0);
    });
    test('live: a 200 with no day serves last-good', async () => {
        kv.set('scoreboard-day:nba:lastgood', { value: JSON.stringify({ day: '2026-10-09', events: [{ id: 'old' }] }) });
        fetchMock.mockResolvedValueOnce(body({ content: { sbData: { events: [{ id: '1' }] } } }));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        expect(await getScoreboardForDay('nba', null)).toEqual({ day: '2026-10-09', events: [{ id: 'old' }], degraded: false, stale: true });
        expect(kv.has('scoreboard-day:nba')).toBe(false);
    });
    test('a fresh live read carries no stale flag', async () => {
        fetchMock.mockResolvedValueOnce(payload('2026-10-21', ['1']));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        expect((await getScoreboardForDay('nba', null)).stale).toBeUndefined();
    });
    test('dated: TTL is a day only for a past day, else the live TTL', async () => {
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        fetchMock.mockResolvedValueOnce(payload('2025-04-15', ['9']));
        await getScoreboardForDay('nba', '20250415', { pastDay: true });
        expect(kv.get('scoreboard-day:nba:20250415')?.ttl).toBe(86400);
        fetchMock.mockResolvedValueOnce(payload('2025-04-16', ['9']));
        await getScoreboardForDay('nba', '20250416');
        expect(kv.get('scoreboard-day:nba:20250416')?.ttl).toBe(120);
    });
    test('a 200 without an events list is a bad body, not an empty day', async () => {
        // ESPN's real empty day is `events: []` (2025-07-15, 2025-02-14); a missing or non-list
        // `events` must take the degraded path, never "No games scheduled" or a sort crash
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        for (const sbData of [{ day: { date: '2025-04-15' } }, { day: { date: '2025-04-15' }, events: null }, { day: { date: '2025-04-15' }, events: { id: '1' } }]) {
            fetchMock.mockResolvedValueOnce(body({ content: { sbData } }));
            expect(await getScoreboardForDay('nba', '20250415', { pastDay: true })).toMatchObject({ events: [], degraded: true });
        }
        fetchMock.mockResolvedValueOnce(body({ content: { sbData: { day: { date: '2026-10-21' }, events: { id: '1' } } } }));
        expect(await getScoreboardForDay('nba', null)).toMatchObject({ events: [], degraded: true });
        expect(kv.size).toBe(0);
    });
    test('dated: an empty day is returned but not cached', async () => {
        fetchMock.mockResolvedValueOnce(payload('2025-07-15', []));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        expect(await getScoreboardForDay('nba', '20250715', { pastDay: true })).toEqual({ day: '2025-07-15', events: [], degraded: false });
        expect(kv.size).toBe(0);
    });
    test('a throwing KV is a cache miss, not a 500', async () => {
        kvFail = true;
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        fetchMock.mockResolvedValueOnce(payload('2025-04-15', ['9']));
        expect((await getScoreboardForDay('nba', '20250415')).events).toHaveLength(1);
        fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
        expect(await getScoreboardForDay('nba', null)).toMatchObject({ events: [], degraded: true });
    });
});
