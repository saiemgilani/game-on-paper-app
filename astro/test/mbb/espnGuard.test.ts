import { beforeEach, describe, expect, test, vi } from 'vitest';

// An unknown men's college id: ESPN answers with a 302 to its HTML scoreboard (curl 2026-10-18, requestESPN's Safari UA:
// cdn.espn.com/core/mens-college-basketball/playbyplay?gameId=401999999&xhr=1 -> `302 http://cdn.espn.com/mens-college-basketball/scoreboard`);
// that is "not found", not an outage.
const kv = new Map<string, string>();
const fetchMock = vi.fn();
vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')
        ? { get: async (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!) : null), put: async (key: string, value: string) => { kv.set(key, value); } }
        : undefined) }),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), wrappedFetch: (...a: unknown[]) => fetchMock(...a) }));

beforeEach(() => { kv.clear(); fetchMock.mockReset(); });

describe('retrieveGamePageGuarded for men\'s college basketball', () => {
    test("asks ESPN's mens-college-basketball path and reads an HTML redirect target as not found", async () => {
        fetchMock.mockResolvedValue(new Response('<!DOCTYPE html><html>scoreboard</html>', { status: 200 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('401999999', 'mbb')).toMatchObject({ page: null, fetchFailed: false });
        expect(String(fetchMock.mock.calls[0][0])).toContain('https://cdn.espn.com/core/mens-college-basketball/playbyplay?gameId=401999999');
    });
    test('a 403 with nothing in KV is a failed fetch', async () => {
        fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('401820775', 'mbb')).toMatchObject({ page: null, fetchFailed: true });
    });
});
