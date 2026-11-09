// The shooting pages sit behind the same 'wbb' flag as the scoreboard: plan #4's middleware loop gates the whole prefix.
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

// plus the Task 7 review's paths: /wbb/teams, the p26 player (5239100, Joyce Edwards) and a past-season team page
const PAGES = ['/wbb', '/wbb/players', '/wbb/players?team=2579', '/wbb/players/5106164', '/wbb/players/5239100', '/wbb/teams', '/wbb/teams?season=2019',
    '/wbb/team/2579', '/wbb/team/2579?season=2022', '/wbb/team/2837', '/wbb/scatter', '/wbb/leaders', '/wbb/leaders?season=2019'];

describe('the WBB shooting pages behind the wbb flag', () => {
    test('still a preview feature', () => expect(FLAGS['wbb']).toBe('preview'));
    test('a public viewer gets the 404 on every shooting page', async () => {
        for (const p of PAGES) expect(await run(p, null), p).toBe('/404');
    });
    test('a preview viewer reaches them', async () => {
        const cookie = await mintPreviewCookie('test-secret');
        for (const p of PAGES) expect(await run(p, cookie), p).not.toBe('/404');
    });
});
