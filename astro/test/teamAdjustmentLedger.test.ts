import { beforeEach, describe, expect, test, vi } from 'vitest';
import { LEDGER_COLUMNS } from '../src/utils/scheduleEffect';

// B2's read ('cfb-schedule-effect'): one team-season of team_adjustment_ledger, the panel's columns only, and null (never
// a partial ledger) on any failure. Every request goes through the mocked wrappedFetch.
const seen: string[] = [];
let respond: () => Response = () => new Response(JSON.stringify({ data: [{ team_id: '99' }], next: null }), { status: 200 });

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (String(url).endsWith('/v1/meta')) return new Response('{}', { status: 200 });
        seen.push(String(url));
        return respond();
    },
}));
vi.mock('cloudflare:workers', () => {
    const kv = {
        get: async () => null,
        getWithMetadata: async () => ({ value: null, metadata: null }),
        put: async () => {},
        delete: async () => {},
    };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});

beforeEach(() => {
    seen.length = 0;
    respond = () => new Response(JSON.stringify({ data: [{ team_id: '99' }], next: null }), { status: 200 });
});

describe('retrieveTeamAdjustmentLedger', () => {
    test('one team-season URL with the panel columns', async () => {
        const { retrieveTeamAdjustmentLedger } = await import('../src/resources/sdv');
        expect(await retrieveTeamAdjustmentLedger(2025, 99, 'cfb')).toEqual([{ team_id: '99' }]);
        expect(seen).toHaveLength(1);
        const u = new URL(seen[0]);
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/cfb/team_adjustment_ledger');
        expect(u.searchParams.get('season')).toBe('2025');
        expect(u.searchParams.get('team_id')).toBe('99');
        expect(u.searchParams.get('select')?.split(',')).toEqual(LEDGER_COLUMNS);
    });

    test('a failed read or a body without a data array is null; the NFL makes no read', async () => {
        const { retrieveTeamAdjustmentLedger } = await import('../src/resources/sdv');
        respond = () => new Response('oops', { status: 500 });
        expect(await retrieveTeamAdjustmentLedger(2024, 61, 'cfb')).toBeNull();
        respond = () => new Response(JSON.stringify({ error: 'no table' }), { status: 200 });
        expect(await retrieveTeamAdjustmentLedger(2023, 61, 'cfb')).toBeNull();
        seen.length = 0;
        expect(await retrieveTeamAdjustmentLedger(2025, 14, 'nfl')).toBeNull();
        expect(seen).toEqual([]);
    });
});
