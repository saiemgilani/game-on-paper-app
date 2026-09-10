import { describe, expect, test, vi } from 'vitest';

// The /nfl prefix is a REWRITE onto the shared page files with
// locals.league = 'nfl' (same mechanism as /preview/*). These run the real
// middleware: a regression here means every /nfl URL 404s or renders CFB.
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';

async function run(url: string) {
    const locals: Record<string, unknown> = {};
    const nextCalls: unknown[] = [];
    const ctx: any = {
        request: new Request(url),
        locals,
        cache: { set: () => {} },
        redirect: (l: string, s = 302) => new Response(null, { status: s, headers: { Location: l } }),
    };
    // Astro's `next(rewritePath)` form: the argument is the rewrite target,
    // undefined when the request is served as-is.
    const res = await (onRequest as any)(ctx, async (rewrite?: unknown) => { nextCalls.push(rewrite); return new Response('ok'); });
    return { locals, res, nextCalls };
}

describe('league prefix rewrite', () => {
    test('/nfl/game/1 sets locals.league=nfl and rewrites to /game/1 with its query', async () => {
        const { locals, nextCalls } = await run('https://gameonpaper.com/nfl/game/1?span=q1');
        expect(locals.league).toBe('nfl');
        expect(nextCalls).toEqual(['/game/1?span=q1']);
    });
    test('/nfl alone is the nfl scoreboard', async () => {
        const { locals, nextCalls } = await run('https://gameonpaper.com/nfl');
        expect(locals.league).toBe('nfl');
        expect(nextCalls).toEqual(['/']);
    });
    test('cfb paths are untouched', async () => {
        const { locals, nextCalls } = await run('https://gameonpaper.com/game/1');
        expect(locals.league).toBe('cfb');
        expect(nextCalls).toEqual([undefined]);
    });
    test('/nflx is not the nfl', async () => {
        const { locals, nextCalls } = await run('https://gameonpaper.com/nflx');
        expect(locals.league).toBe('cfb');
        expect(nextCalls).toEqual([undefined]);
    });
});
