// Every test file runs behind this guard (vitest.config.ts setupFiles). Global fetch refuses every
// host but localhost, so a read a test forgot to mock fails that test instead of reaching the Data
// API with the dummy SDV_AUTH_TOKEN: each such read is a failed auth, and a run's worth of them
// locked this machine's IP out with 429s on Nov 4-5.
// A test that mocks fetch itself (vi.stubGlobal('fetch', ...), vi.spyOn(globalThis, 'fetch'), or a
// module mock of wrappedFetch / a resource) replaces the guard and keeps working; vi.unstubAllGlobals()
// and mockRestore() put the guard back, never the real fetch.
import { afterAll, afterEach, expect } from 'vitest';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const realFetch = globalThis.fetch;
const blocked: string[] = [];

globalThis.fetch = async function networkGuard(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    let host = '';
    try { host = new URL(url).hostname; } catch { /* a relative or malformed URL is blocked too */ }
    if (LOCAL_HOSTS.has(host)) {
        // redirects come back through the guard, so a local server cannot bounce a request to a real host
        // ponytail: no hop limit or 303-to-GET rewrite; a test needing either mocks fetch itself
        const res = await realFetch(input, { ...init, redirect: 'manual' });
        const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        return to ? networkGuard(new URL(to, url).href, init) : res;
    }
    const { currentTestName, testPath } = expect.getState();
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const msg = `unmocked request: ${method} ${url} in ${currentTestName ? `"${currentTestName}"` : 'no test (file setup)'} (${testPath ?? 'unknown file'})`;
    blocked.push(msg);
    console.error(`[network-guard] blocked ${msg}`);
    throw new Error(`[network-guard] ${msg}. Mock it in the test.`);
};

// The app catches most fetch failures and renders around them (an empty card, an unversioned cache
// key), so the throw alone would not fail the test; this does.
const fail = (where: string) => {
    if (!blocked.length) return;
    const lines = blocked.splice(0);
    throw new Error(`[network-guard] ${lines.length} unmocked network request(s) ${where}:\n${lines.join('\n')}`);
};
afterEach(() => fail('in this test'));
afterAll(() => fail('outside any test'));
