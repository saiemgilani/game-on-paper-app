import { expect, test, vi } from 'vitest';

// Own file: the /v1/meta promise is memoised per module instance, so this needs a fresh one.
vi.mock('../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/v1/meta')) {
            // a /v1/meta that accepts the connection and never answers, unless its signal fires
            return new Promise<Response>((_, reject) => {
                const s = init?.signal;
                if (!s) return;
                if (s.aborted) reject(s.reason);
                s.addEventListener('abort', () => reject(s.reason));
            });
        }
        return Promise.resolve(new Response(JSON.stringify({ espn_id: '4837248' }), { status: 200 }));
    } }));

test('a stalled /v1/meta gives up, and the read behind it still answers', async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    const { SDV_META_TIMEOUT_MS, retrievePlayer } = await import('../src/resources/sdv');
    // fire the meta deadline at once; every other read keeps its real window
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) =>
        ms === SDV_META_TIMEOUT_MS ? AbortSignal.abort(new DOMException('timed out', 'TimeoutError')) : real(ms));
    expect(await retrievePlayer('4837248')).toMatchObject({ espn_id: '4837248' });
});
