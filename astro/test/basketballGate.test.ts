// astro/test/basketballGate.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { FLAGS } from '../src/utils/features';
import { PREFIXED_LEAGUES } from '../src/utils/league';

async function rewrite(path: string) {
    let to: string | undefined = 'never-called';
    const ctx: any = { request: new Request(`https://gameonpaper.com${path}`), locals: {}, cache: { set: () => {} }, redirect: (l: string, s = 302) => new Response(null, { status: s, headers: { Location: l } }) };
    await (onRequest as any)(ctx, async (t?: string) => { to = t; return new Response('ok'); });
    return to;
}

describe('one namespace gate per prefixed league (Review Focus 5)', () => {
    test('every prefixed league has a flag named by its slug', () => {
        for (const lg of PREFIXED_LEAGUES) expect(FLAGS[lg], lg).toBeDefined();
    });
    test('a public viewer is 404d on every preview league prefix and nowhere else', async () => {
        for (const lg of PREFIXED_LEAGUES) {
            if (FLAGS[lg] !== 'preview') continue;
            for (const p of [`/${lg}`, `/${lg}/`, `/${lg}/game/401766458`]) expect(await rewrite(p), p).toBe('/404');
        }
        for (const p of ['/', '/teams', '/nbax', '/nflx/game/1', '/game/401752746']) expect(await rewrite(p), p).not.toBe('/404');
    });
    test('the gate names no league literally', () => {
        const src = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
        expect(src).not.toMatch(/'\/nba'|'\/nba\/'|isFeatureEnabled\('nba'/);
    });
});
