// Vitest setup file (vitest.config.ts `test.setupFiles`): no test may reach the
// network. Unmocked reads have locked the Data API out with 429s before.
// Every source path (wrappedFetch/timedFetch in src/utils/telemetry.ts, the
// admin and pro routes) calls the global `fetch`, so replacing it covers them.
// The call rejects, and the test still fails in afterEach even when the code
// under test swallows the rejection (most resource readers catch and fall back).
// A test that stubs fetch itself (vi.stubGlobal / vi.spyOn) replaces this guard.
import { afterEach } from 'vitest';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const realFetch = globalThis.fetch;
let blocked: string[] = [];

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const href = input instanceof Request ? input.url : String(input);
    const url = new URL(href, 'http://localhost');
    if (LOCAL.has(url.hostname)) return realFetch(input, init);
    blocked.push(`${init?.method ?? 'GET'} ${url.href}`);
    return Promise.reject(new Error(`network guard: test tried to fetch ${url.href}; stub the read`));
};

afterEach(() => {
    if (!blocked.length) return;
    const msg = `network guard: test reached the network:\n  ${blocked.join('\n  ')}`;
    blocked = [];
    throw new Error(msg);
});
