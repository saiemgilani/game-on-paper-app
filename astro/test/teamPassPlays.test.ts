import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PASS_PLAY_COLUMNS } from '../src/utils/passDirection';

// The 'team-pass-direction' read: one team-season of pbp pass attempts per side (pos_team_id, def_pos_team_id), the
// panel's columns only, and null (never one side, never a cut-short page) on any failure. Every request goes through the
// mocked wrappedFetch.
const seen: string[] = [];
let respond: (url: URL) => Response;
const ok = (url: URL) => new Response(JSON.stringify({ data: [{ side: url.searchParams.has('pos_team_id') ? 'off' : 'def' }], next: null }), { status: 200 });

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (String(url).endsWith('/v1/meta')) return new Response('{}', { status: 200 });
        seen.push(String(url));
        return respond(new URL(String(url)));
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
    respond = ok;
});

describe('retrieveTeamPassPlays', () => {
    test('two team-season URLs, one per side, with the panel columns and pass attempts only', async () => {
        const { retrieveTeamPassPlays } = await import('../src/resources/sdv');
        expect(await retrieveTeamPassPlays(2026, 333, 'cfb')).toEqual({ off: [{ side: 'off' }], def: [{ side: 'def' }] });
        expect(seen).toHaveLength(2);
        const urls = seen.map((s) => new URL(s));
        for (const u of urls) {
            expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/cfb/pbp');
            expect(u.searchParams.get('season')).toBe('2026');
            expect(u.searchParams.get('pass_attempt')).toBe('true');
            // spelled out, not PASS_PLAY_COLUMNS: dropping a column the panel reads fails here
            expect(u.searchParams.get('select')?.split(',').sort()).toEqual(['EPA', 'EPA_success', 'air_yards', 'completion', 'game_id', 'pass_depth', 'pass_direction', 'sack']);
            expect(u.searchParams.get('select')?.split(',')).toEqual(PASS_PLAY_COLUMNS);
        }
        expect(urls.map((u) => [u.searchParams.get('pos_team_id'), u.searchParams.get('def_pos_team_id')]).sort())
            .toEqual([[null, '333'], ['333', null]]);
    });

    test('one side failing, a body without a data array or a full page is null; the NFL makes no read', async () => {
        const { retrieveTeamPassPlays, TEAM_PASS_PLAYS_LIMIT } = await import('../src/resources/sdv');
        respond = (u) => (u.searchParams.has('def_pos_team_id') ? new Response('oops', { status: 500 }) : ok(u));
        expect(await retrieveTeamPassPlays(2025, 61, 'cfb')).toBeNull();
        respond = () => new Response(JSON.stringify({ error: 'no table' }), { status: 200 });
        expect(await retrieveTeamPassPlays(2024, 61, 'cfb')).toBeNull();
        respond = () => new Response(JSON.stringify({ data: Array.from({ length: TEAM_PASS_PLAYS_LIMIT }, () => ({})), next: null }), { status: 200 });
        expect(await retrieveTeamPassPlays(2023, 61, 'cfb')).toBeNull();
        respond = () => new Response(JSON.stringify({ data: [{}], next: 'offset=1' }), { status: 200 });
        expect(await retrieveTeamPassPlays(2022, 61, 'cfb')).toBeNull();
        seen.length = 0;
        expect(await retrieveTeamPassPlays(2025, 14, 'nfl')).toBeNull();
        expect(seen).toEqual([]);
    });
});
