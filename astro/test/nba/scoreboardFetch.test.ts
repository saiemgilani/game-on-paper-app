import { beforeEach, describe, expect, test, vi } from 'vitest';

const kv = new Map<string, { value: string; ttl?: number }>();
const fetchMock = vi.fn();
vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')
        ? { get: async (key: string, _t?: string) => (kv.has(key) ? JSON.parse(kv.get(key)!.value) : null),
            getWithMetadata: async (key: string) => (kv.has(key) ? { value: JSON.parse(kv.get(key)!.value), metadata: { fetchedAt: Date.now() } } : { value: null }),
            put: async (key: string, value: string, opts?: { expirationTtl?: number }) => { kv.set(key, { value, ttl: opts?.expirationTtl }); } }
        : undefined) }),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), wrappedFetch: (...a: unknown[]) => fetchMock(...a) }));

const payload = (day: string, ids: string[]) => new Response(JSON.stringify({ content: { sbData: { day: { date: day }, events: ids.map((id) => ({ id, date: `${day}T23:00Z`, competitions: [{ competitors: [] }], status: { type: { name: 'STATUS_SCHEDULED' } } })) } } }), { status: 200 });

beforeEach(() => { kv.clear(); fetchMock.mockReset(); });

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
        const r = await getScoreboardForDay('nba', '20250415');
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
        expect(live).toEqual({ day: '2026-10-09', events: [{ id: 'old' }], degraded: false });
        const dated = await getScoreboardForDay('nba', '20250415');
        expect(dated).toEqual({ day: '2025-04-15', events: [], degraded: true });
        expect(kv.has('scoreboard-day:nba:20250415')).toBe(false);
    });
});
