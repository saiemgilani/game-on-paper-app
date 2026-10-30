// The shooting pages sit behind the same 'wnba' flag as the scoreboard: plan #4's middleware loop gates the whole prefix.
import { describe, expect, test, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../../src/utils/preview';
import { FLAGS } from '../../src/utils/features';

async function run(path: string, cookie: string | null) {
    let rewrittenTo: string | undefined = 'never-called';
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, { headers: cookie ? { cookie: `${PREVIEW_COOKIE}=${cookie}` } : {} }),
        locals: {}, cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    await (onRequest as any)(ctx, async (to?: string) => { rewrittenTo = to; return new Response('ok'); });
    return rewrittenTo;
}

const PAGES = ['/wnba', '/wnba/players', '/wnba/players/1643428', '/wnba/teams?season=2003', '/wnba/team/1611661328', '/wnba/scatter', '/wnba/leaders?season=2003'];

describe('the WNBA shooting pages behind the wnba flag', () => {
    test('still a preview feature', () => expect(FLAGS['wnba']).toBe('preview'));
    test('a public viewer gets the 404 on every shooting page', async () => {
        for (const p of PAGES) expect(await run(p, null), p).toBe('/404');
    });
    test('a preview viewer reaches them', async () => {
        const cookie = await mintPreviewCookie('test-secret');
        for (const p of PAGES) expect(await run(p, cookie), p).not.toBe('/404');
    });
});
