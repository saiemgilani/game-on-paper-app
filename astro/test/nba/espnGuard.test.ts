import { beforeEach, describe, expect, test, vi } from 'vitest';

// retrieveGamePageGuarded swallows a failed cdn fetch; fetchFailed is how a caller tells that from a page
const kv = new Map<string, string>();
const fetchMock = vi.fn();
vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')
        ? { get: async (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!) : null), put: async (key: string, value: string) => { kv.set(key, value); } }
        : undefined) }),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), wrappedFetch: (...a: unknown[]) => fetchMock(...a) }));

beforeEach(() => { kv.clear(); fetchMock.mockReset(); });

describe('retrieveGamePageGuarded', () => {
    test('a failed fetch with nothing in KV is page null, fetchFailed', async () => {
        fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('401766458', 'nba')).toMatchObject({ page: null, fetchFailed: true });
    });
    test("a failed fetch served from KV's last copy still says fetchFailed", async () => {
        kv.set('gamecontent:nba:401766458', JSON.stringify({ gameId: 401766458 }));
        fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('401766458', 'nba')).toMatchObject({ page: { gameId: 401766458 }, fetchFailed: true });
    });
});

describe('an unknown game id', () => {
    test("ESPN's redirect to an HTML scoreboard is not found, not a failed fetch", async () => {
        fetchMock.mockResolvedValue(new Response('<!DOCTYPE html><html>scoreboard</html>', { status: 200 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('999999999', 'nba')).toMatchObject({ page: null, fetchFailed: false });
    });
    test('a 404 is not found, not a failed fetch', async () => {
        fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
        const { retrieveGamePageGuarded } = await import('../../src/resources/espn');
        expect(await retrieveGamePageGuarded('999999999', 'nba')).toMatchObject({ page: null, fetchFailed: false });
    });
});
