import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

// The SDV_API_CACHE key carries each table's ingest stamp from `GET /v1/meta`
// (`datasets["cfb.percentiles"]`), so a re-ingest misses every entry cached
// before it instead of serving pre-ingest numbers for the rest of a 3-day TTL.
// These pin: a new stamp is a new key; a failed or silent meta read falls back
// to the unversioned key (the behaviour before this); and meta is read at most
// once per SDV_META_TTL, shared through KV, never once per request.
const META = 'https://data.sportsdataverse.org/v1/meta';
const TABLE_URL = 'percentiles?season=2025&pctile=50';
const seen: string[] = [];
let meta: () => Response;
const store = new Map<string, { value: string; expires: number }>();
const gets: string[] = [];
const puts: { key: string; ttl?: number }[] = [];

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        seen.push(String(url));
        return String(url) === META ? meta() : new Response(JSON.stringify({ data: [{ pctile: 50 }] }), { status: 200 });
    },
}));
vi.mock('cloudflare:workers', () => {
    const kv = {
        get: async (key: string, type?: string) => {
            gets.push(key);
            const hit = store.get(key);
            if (!hit || hit.expires <= Date.now()) return null;
            return type === 'json' ? JSON.parse(hit.value) : hit.value;
        },
        put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
            puts.push({ key, ttl: opts?.expirationTtl });
            store.set(key, { value, expires: Date.now() + (opts?.expirationTtl ?? 1e9) * 1000 });
        },
        delete: async (key: string) => { store.delete(key); },
    };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});

const stamped = (ts: string) => () => new Response(JSON.stringify({ leagues: {}, datasets: { 'cfb.percentiles': ts } }), { status: 200 });
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
/** the table read's KV key: the last get that is not the meta entry */
const tableKey = () => gets.filter(k => !k.startsWith('sdv-meta')).at(-1)!;
const metaCalls = () => seen.filter(u => u === META).length;
const tableCalls = () => seen.filter(u => u !== META).length;
// a fresh module = a fresh isolate: no in-memory meta, KV (`store`) survives
const load = async () => { vi.resetModules(); return import('../src/resources/sdv'); };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    seen.length = 0; gets.length = 0; puts.length = 0; store.clear();
    meta = stamped('2026-09-27T12:05:07+00:00');
});
afterEach(() => { vi.useRealTimers(); });

describe('SDV_API_CACHE key carries the table ingest stamp', () => {
    test('a new ingest stamp produces a different key, and the next read misses the old entry', async () => {
        const sdv = await load();
        await sdv.retrievePercentiles(2025, 50);
        const before = tableKey();
        expect(before).not.toBe(await sha256(TABLE_URL));
        expect(before).toBe(await sha256(`${TABLE_URL}#2026-09-27T12:05:07+00:00`));

        // re-ingest; once the stamp's TTL has passed the next read uses a new key
        meta = stamped('2026-09-28T15:00:00+00:00');
        vi.setSystemTime(new Date('2026-09-27T12:05:01Z'));
        await sdv.retrievePercentiles(2025, 50);
        const after = tableKey();
        expect(after).not.toBe(before);
        expect(after).toBe(await sha256(`${TABLE_URL}#2026-09-28T15:00:00+00:00`));
        expect(tableCalls()).toBe(2); // the old entry is still in KV, but never read again
    });

    test('a failed meta read falls back to the unversioned key', async () => {
        meta = () => new Response('down', { status: 503 });
        const sdv = await load();
        const rows = await sdv.retrievePercentiles(2025, 50);
        expect(rows).toEqual([{ pctile: 50 }]);
        expect(tableKey()).toBe(await sha256(TABLE_URL));
        expect(puts.some(p => p.key.startsWith('sdv-meta'))).toBe(false); // a failure is never shared
    });

    test('a meta fetch that throws, or a body without datasets, also falls back', async () => {
        meta = () => { throw new Error('network'); };
        let sdv = await load();
        await sdv.retrievePercentiles(2025, 50);
        expect(tableKey()).toBe(await sha256(TABLE_URL));

        meta = () => new Response(JSON.stringify({ detail: 'nope' }), { status: 200 });
        sdv = await load();
        await sdv.retrievePercentiles(2025, 50);
        expect(tableKey()).toBe(await sha256(TABLE_URL));
    });

    test('a table meta does not list keeps the unversioned key', async () => {
        const sdv = await load();
        await sdv.retrieveQaSeason(2025);
        expect(tableKey()).toBe(await sha256('qa?season=2025'));
    });
});

describe('the ingest stamp is cached, not fetched per request', () => {
    test('one meta fetch per SDV_META_TTL per isolate, stored in KV for 5 minutes', async () => {
        const sdv = await load();
        await sdv.retrievePercentiles(2025, 50);
        await sdv.retrievePercentiles(2024, 50);
        vi.setSystemTime(new Date('2026-09-27T12:04:59Z'));
        await sdv.retrievePercentiles(2023, 50);
        expect(metaCalls()).toBe(1);
        expect(puts.filter(p => p.key.startsWith('sdv-meta'))).toEqual([{ key: 'sdv-meta:datasets', ttl: 300 }]);

        vi.setSystemTime(new Date('2026-09-27T12:05:01Z'));
        await sdv.retrievePercentiles(2022, 50);
        expect(metaCalls()).toBe(2);
    });

    test('concurrent reads in a fresh isolate share one in-flight meta fetch', async () => {
        const sdv = await load();
        const seasons = [2025, 2024, 2023, 2022, 2021, 2020];
        await Promise.all(seasons.map(s => sdv.retrievePercentiles(s, 50)));
        expect(metaCalls()).toBe(1);
        expect(gets.filter(k => k.startsWith('sdv-meta'))).toHaveLength(1);
        expect(tableCalls()).toBe(6);
        // every caller waits for that one read: none falls through to the unversioned
        // (pre-ingest) key while it is in flight
        const versioned = await Promise.all(seasons.map(s => sha256(`percentiles?season=${s}&pctile=50#2026-09-27T12:05:07+00:00`)));
        expect(gets.filter(k => !k.startsWith('sdv-meta')).sort()).toEqual(versioned.sort());
    });

    test('a failed meta read is retried once the window has passed', async () => {
        meta = () => new Response('down', { status: 503 });
        const sdv = await load();
        await Promise.all([2025, 2024, 2023].map(s => sdv.retrievePercentiles(s, 50)));
        expect(metaCalls()).toBe(1); // concurrent callers share the failure, no per-request retry storm
        const unversioned = await Promise.all([2025, 2024, 2023].map(s => sha256(`percentiles?season=${s}&pctile=50`)));
        expect(gets.filter(k => !k.startsWith('sdv-meta')).sort()).toEqual(unversioned.sort());

        meta = stamped('2026-09-27T12:05:07+00:00');
        vi.setSystemTime(new Date('2026-09-27T12:05:01Z'));
        await sdv.retrievePercentiles(2025, 50);
        expect(metaCalls()).toBe(2);
        expect(tableKey()).toBe(await sha256(`${TABLE_URL}#2026-09-27T12:05:07+00:00`));
    });

    test('a new isolate reads the stamp from KV instead of the Data API', async () => {
        await (await load()).retrievePercentiles(2025, 50);
        await (await load()).retrievePercentiles(2025, 50);
        expect(metaCalls()).toBe(1);
        expect(tableCalls()).toBe(1); // same stamp, same key: the second isolate hits the entry
    });
});
