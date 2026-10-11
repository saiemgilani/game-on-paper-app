import { describe, expect, test, vi } from 'vitest';

// A 200 whose body carries no `data` array (here the identity-route shape) is not an empty table:
// a strict read must reject so a route answers 503, not 404.
vi.mock('../../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) =>
        new Response(String(url).endsWith('/v1/meta') ? JSON.stringify({ datasets: {} }) : JSON.stringify({ espn_id: 1 }), { status: 200 }),
}));
vi.mock('cloudflare:workers', () => {
    const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});

describe('retrieveRows', () => {
    test('strict rejects a body without a data array; non-strict returns []', async () => {
        const { retrieveRows } = await import('../../src/resources/sdv');
        await expect(retrieveRows('nba', 'shots', {}, 60, true)).rejects.toMatchObject({ status: 502 });
        await expect(retrieveRows('nba', 'shots', {}, 60)).resolves.toEqual([]);
    });
});
