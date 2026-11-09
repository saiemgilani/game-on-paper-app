import { expect, test, vi } from 'vitest';

// No GOP_INGEST_KEY: this Worker ships no telemetry of its own, but the API still logs its
// request rows, so the visitor must still reach requestProcessor (Sourcery on #387).
vi.mock('astro:env/server', () => ({ getSecret: () => undefined }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));
vi.mock('cloudflare:workers', () => ({ env: {} }));

import { onRequest } from '../src/middleware';
import { callerHeaders } from '../src/utils/telemetry';

test('the visitor reaches callerHeaders() with Worker telemetry off', async () => {
    let seen: Record<string, string> = {};
    const ctx: any = {
        request: new Request('https://gameonpaper.com/game/401520150', {
            headers: { 'cf-connecting-ip': '67.183.195.118', 'user-agent': 'crawler/1' },
        }),
        locals: {},
        cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    await (onRequest as any)(ctx, async () => { seen = callerHeaders(); return new Response('ok'); });
    expect(seen).toEqual({ 'X-GOP-Client-IP': '67.183.195.118', 'X-GOP-Client-UA': 'crawler/1', 'X-GOP-Page': '/game/401520150' });
});
