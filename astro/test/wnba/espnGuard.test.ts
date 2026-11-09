import { beforeEach, describe, expect, test, vi } from 'vitest';

// ESPN answers an unknown WNBA id with a 302 to its HTML scoreboard (curl, 2026-10-12: gameId=401999999 ->
// http://cdn.espn.com/wnba/scoreboard); fetch follows it, so the body is HTML. That is "not found", not an outage.
const kv = new Map<string, string>();
const fetchMock = vi.fn();
vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')
        ? { get: async (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!) : null), put: async (key: string, value: string) => { kv.set(key, value); } }
        : undefined) }),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), wrappedFetch: (...a: unknown[]) => fetchMock(...a) }));

beforeEach(() => { kv.clear(); fetchMock.mockReset(); });

describe('retrieveGamePageGuarded for the WNBA', () => {
    test("asks ESPN's wnba path and reads an HTML redirect target as not found", async () => {
        fetchMock.mockResolvedValue(new Response('<!DOCTYPE html><html>scoreboard</html>', { status: 200 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('401999999', 'wnba')).toMatchObject({ page: null, fetchFailed: false });
        expect(String(fetchMock.mock.calls[0][0])).toContain('https://cdn.espn.com/core/wnba/playbyplay?gameId=401999999');
    });
    test('a 403 with nothing in KV is a failed fetch', async () => {
        fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('401736287', 'wnba')).toMatchObject({ page: null, fetchFailed: true });
    });
});
