import { beforeEach, describe, expect, test, vi } from 'vitest';

// A settled final's processed payload is kept in R2 (resources/python.ts processPlays): the second
// render of it never reaches the processor, whatever data centre or deploy it lands on.
const processorCalls: string[] = [];
let payload: any = { plays: [{ id: 1, winProbability: {} }], teamInfo: { home: { id: '1' }, away: { id: '2' } }, header: { competitions: [{ status: { type: { completed: true } } }] } };
const bucket = new Map<string, { body: ArrayBuffer; meta: any }>();
const reads: string[] = [];
// distinct, so the stored metadata is seen to name the processor version, not the app's
vi.mock('astro:env/server', async (orig) => {
    const real = await orig<typeof import('astro:env/server')>();
    const versions: Record<string, string> = { APP_VERSION: 'app-test', PROCESSOR_VERSION: 'processor-test' };
    return { ...real, getSecret: (k: string) => versions[k] ?? real.getSecret(k) };
});

vi.mock('../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => { processorCalls.push(String(url)); return new Response(JSON.stringify(payload), { status: 200 }); } }));
vi.mock('cloudflare:workers', () => ({ env: { PRO_BUCKET: {
    get: async (k: string) => { reads.push(k); const o = bucket.get(k); return o ? { body: new Blob([o.body]).stream() } : null; },
    put: async (k: string, body: ArrayBuffer, opts: any) => { bucket.set(k, { body, meta: opts?.customMetadata }); },
} } }));

beforeEach(() => { processorCalls.length = 0; reads.length = 0; bucket.clear(); payload.plays = [{ id: 1, winProbability: {} }]; });

describe('settled finals in R2', () => {
    test('the first render processes and keeps the payload gzipped; the second reads it back', async () => {
        const { retrieveProcessedGame, CACHE_GENERATION } = await import('../src/resources/python');
        expect(CACHE_GENERATION).toBe('1');  // python/CACHE_GENERATION, comment lines skipped
        await retrieveProcessedGame('252810251', 60, 'cfb', undefined, false, 600, true);
        expect(processorCalls).toHaveLength(1);
        const key = 'processed/g1/cfb/252810251.json.gz';
        expect([...bucket.keys()]).toEqual([key]);
        const stored = await new Response(new Blob([bucket.get(key)!.body]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
        expect(stored.plays[0].id).toBe(1);
        expect(bucket.get(key)!.meta).toEqual({ processor: 'processor-test' });

        const again = await retrieveProcessedGame('252810251', 60, 'cfb', undefined, false, 600, true);
        expect(processorCalls).toHaveLength(1);
        expect(again.plays[0].id).toBe(1);
    });
    test('a game that is not settled, or carries a source, never touches R2', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        await retrieveProcessedGame('401520150', 60, 'cfb');
        await retrieveProcessedGame('401520151', 60, 'cfb', 'sports 247', false, 600, true);
        expect(processorCalls).toHaveLength(2);
        expect(reads).toEqual([]);
        expect(bucket.size).toBe(0);
    });
    test('a payload without plays is not kept', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        payload.plays = [];
        await expect(retrieveProcessedGame('252810252', 60, 'cfb', undefined, false, 600, true)).rejects.toThrow('no PBP');
        expect(bucket.size).toBe(0);
    });
    test('a payload the render cannot shape is not kept', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const teamInfo = payload.teamInfo;
        delete payload.teamInfo;
        try {
            await expect(retrieveProcessedGame('252810253', 60, 'cfb', undefined, false, 600, true)).rejects.toThrow();
        } finally { payload.teamInfo = teamInfo; }
        expect(bucket.size).toBe(0);
    });
    test('an unusable stored copy is processed again and replaced', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const key = 'processed/g1/cfb/252810254.json.gz';
        const junk = await new Response(new Blob(['not json']).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        bucket.set(key, { body: junk, meta: {} });
        const got = await retrieveProcessedGame('252810254', 60, 'cfb', undefined, false, 600, true);
        expect(got.plays[0].id).toBe(1);
        expect(processorCalls).toHaveLength(1);
        expect(bucket.get(key)!.meta).toEqual({ processor: 'processor-test' });
    });
});

describe('isSettledFinal', () => {
    test('completed and kicked off two days ago or more', async () => {
        const { isSettledFinal } = await import('../src/routes/game');
        const ago = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
        const done = { type: { completed: true } };
        expect(isSettledFinal({ date: ago(49), status: done })).toBe(true);
        expect(isSettledFinal({ date: ago(47), status: done })).toBe(false);
        expect(isSettledFinal({ date: ago(500), status: { type: { completed: false } } })).toBe(false);
        expect(isSettledFinal({ status: done })).toBe(false);
    });
});
