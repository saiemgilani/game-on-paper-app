// Setup file (vitest.config.ts): a test never reaches the live Data API. The dummy SDV_AUTH_TOKEN used to make every
// unmocked read a fast 401, so a read a test forgot to mock (the pregame's players-to-watch, the teams index's reference
// rows) took its failure path in milliseconds; while data.sportsdataverse.org hangs, the same read hangs the test past its
// timeout instead. Failing those requests at once keeps that path, and the result, independent of the service's health.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).hostname === 'data.sportsdataverse.org') return Promise.reject(new TypeError(`test reached the live Data API: ${url}`));
    return realFetch(input, init);
}) as typeof fetch;
