import { describe, expect, test, vi } from 'vitest';

// The game page's admin tools: a per-request flag-state override
// (?view=live|preview), per-flag overrides (?flags=name:on,name:off) and the
// processing-source switch (?source=). All three are ADMIN tools, so the
// contract under test is mostly negative: for anyone without a valid admin
// session the parameters are inert -- same render, same API request, same
// Workers cache key as today.

vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { mintAdminCookie, ADMIN_COOKIE } from '../src/utils/adminSession';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import {
    adminToolsHref, applyAdminView, currentView, parseFlagOverrides, serializeFlagOverrides,
} from '../src/utils/adminView';
import { isFeatureEnabled } from '../src/utils/features';
import { compareSources } from '../src/utils/sourceCompare';

async function run(path: string, cookies: Record<string, string> = {}) {
    const locals: Record<string, unknown> = {};
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, { headers: cookie ? { cookie } : {} }),
        locals,
        cache: { set: () => {} },
        redirect: (l: string) => new Response(null, { status: 302, headers: { Location: l } }),
    };
    const res = await (onRequest as any)(ctx, async () => new Response('ok'));
    return { locals, res };
}

describe('the query parameters are inert without an admin session', () => {
    const path = '/game/401856682?view=preview&flags=game-page-v2:on&source=shield';

    test('an anonymous request keeps the public flag state', async () => {
        const { locals } = await run(path);
        expect(locals.adminAuthed).toBeUndefined();
        expect(locals.preview).toBeUndefined();
        expect(locals.flagOverrides).toBeUndefined();
        expect(isFeatureEnabled('game-page-v2', locals as any)).toBe(false);
    });

    test('a preview cookie is not an admin session: ?view=live cannot turn it off', async () => {
        const { locals } = await run('/game/401856682?view=live',
            { [PREVIEW_COOKIE]: await mintPreviewCookie('test-secret') });
        expect(locals.preview).toBe(true);
        expect(locals.flagOverrides).toBeUndefined();
    });

    test('an expired admin cookie is no admin session', async () => {
        const stale = await mintAdminCookie('test-secret', Math.floor(Date.now() / 1000) - 13 * 3600);
        const { locals } = await run(path, { [ADMIN_COOKIE]: stale });
        expect(locals.adminAuthed).toBe(false);
        expect(locals.preview).toBeUndefined();
        expect(locals.flagOverrides).toBeUndefined();
    });
});

describe('an authenticated admin overrides the flag state for one request', () => {
    const admin = async () => ({ [ADMIN_COOKIE]: await mintAdminCookie('test-secret') });

    test('?view=live renders what an anonymous visitor gets, despite a preview cookie', async () => {
        const { locals } = await run('/game/401856682?view=live',
            { ...(await admin()), [PREVIEW_COOKIE]: await mintPreviewCookie('test-secret') });
        expect(locals.preview).toBe(false);
        expect(isFeatureEnabled('game-page-v2', locals as any)).toBe(false);
        expect(isFeatureEnabled('source-switch', locals as any)).toBe(false);
    });

    test('?view=preview turns every preview flag on without a preview cookie', async () => {
        const { locals } = await run('/game/401856682?view=preview', await admin());
        expect(locals.preview).toBe(true);
        expect(isFeatureEnabled('game-page-v2', locals as any)).toBe(true);
        expect(isFeatureEnabled('coaches', locals as any)).toBe(true);
    });

    test('a per-flag override moves ONLY that flag', async () => {
        const { locals } = await run('/game/401856682?view=preview&flags=game-page-v2:off', await admin());
        expect(isFeatureEnabled('game-page-v2', locals as any)).toBe(false);
        expect(isFeatureEnabled('source-switch', locals as any)).toBe(true);
        expect(isFeatureEnabled('coaches', locals as any)).toBe(true);
    });

    test('the two compose: Live plus one flag on', async () => {
        const { locals } = await run('/game/401856682?view=live&flags=source-switch:on', await admin());
        expect(isFeatureEnabled('game-page-v2', locals as any)).toBe(false);
        expect(isFeatureEnabled('source-switch', locals as any)).toBe(true);
    });

    test("an admin's render never enters Workers Caching", async () => {
        // ?view=live leaves locals.preview false, so the preview guard alone
        // would have let an admin-only render be cached for everyone.
        const { res } = await run('/game/401856682?view=live', await admin());
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    test('the namespace gates follow the override too', async () => {
        let rewrote: string | undefined;
        const ctx: any = {
            request: new Request('https://gameonpaper.com/nfl/game/401772944?view=preview',
                { headers: { cookie: `${ADMIN_COOKIE}=${await mintAdminCookie('test-secret')}` } }),
            locals: {},
            cache: { set: () => {} },
            redirect: (l: string) => new Response(null, { status: 302, headers: { Location: l } }),
        };
        await (onRequest as any)(ctx, async (r?: string) => { rewrote = r; return new Response('ok'); });
        expect(rewrote).not.toBe('/404');
    });
});

describe('the override parsing', () => {
    test('only exact name:on / name:off entries count', () => {
        expect(parseFlagOverrides('a:on,b:off')).toEqual({ a: true, b: false });
        // a half-typed parameter must never silently flip a flag
        expect(parseFlagOverrides('a,b:,:on,c:yes,d:ON')).toEqual({});
        expect(parseFlagOverrides(null)).toEqual({});
        expect(serializeFlagOverrides({ a: true, b: false })).toBe('a:on,b:off');
    });

    test('currentView reads the parameter, then the resolved state', () => {
        const at = (q: string) => new URL(`https://gameonpaper.com/game/1${q}`);
        expect(currentView(at(''), {})).toBe('live');
        expect(currentView(at(''), { preview: true })).toBe('preview');
        expect(currentView(at('?view=live'), { preview: true })).toBe('live');
        expect(currentView(at('?view=nonsense'), {})).toBe('live');
    });

    test('applyAdminView leaves locals alone when nothing is asked for', () => {
        const locals: any = { preview: true };
        applyAdminView(new URL('https://gameonpaper.com/game/1'), locals);
        expect(locals).toEqual({ preview: true });
    });
});

describe('the toggle hrefs compose instead of replacing each other', () => {
    const url = new URL('https://gameonpaper.com/nfl/game/401772944?source=shield');

    test('flipping the view keeps the selected source', () => {
        expect(adminToolsHref(url, { view: 'live' })).toBe('/nfl/game/401772944?source=shield&view=live');
    });
    test('selecting ESPN clears the parameter rather than pinning the default', () => {
        // the no-source request is the one every other viewer makes, and the
        // one whose cache entry the page already filled
        expect(adminToolsHref(url, { source: null })).toBe('/nfl/game/401772944');
    });
    test('a flag override merges into any already present', () => {
        const withFlags = new URL('https://gameonpaper.com/game/1?flags=coaches:on');
        expect(adminToolsHref(withFlags, { flags: { 'game-page-v2': false } }))
            .toBe('/game/1?flags=coaches%3Aon%2Cgame-page-v2%3Aoff');
        expect(adminToolsHref(withFlags, { flags: { coaches: null } })).toBe('/game/1');
    });
});

describe('the compare table', () => {
    const payload = (teamFactor: number, playIds: string[]) => ({
        teamInfo: { away: { id: '13' }, home: { id: '7' } },
        plays: playIds.map((id) => ({ id })),
        advBoxScore: {
            team: [
                { pos_team: 13, EPA_plays: 60 * teamFactor, EPA_per_play: 0.1, EPA_explosive_rate: 0.12 },
                { pos_team: 7, EPA_plays: 70, EPA_per_play: 0.2, EPA_explosive_rate: 0.1 },
            ],
            situational: [{ pos_team: 13, EPA_success_rate: 0.45 }, { pos_team: 7, EPA_success_rate: 0.5 }],
            turnover: [{ pos_team: 13, turnovers: 2 }, { pos_team: 7, turnovers: 1 }],
            drives: [{ pos_team: 13, drives: 11 }, { pos_team: 7, drives: 12 }],
        },
    }) as any;

    test('delta is selected minus ESPN, and rates are in percentage points', () => {
        const c = compareSources(payload(2, ['a', 'b']), payload(1, ['a', 'b']));
        const away = c.teams[0];
        expect(away.id).toBe('13');   // the payload's own column order, away first
        expect(away.rows.map((r) => r.label)).toEqual(
            ['Plays', 'EPA/Play', 'Success Rate', 'Explosive Play Rate', 'Turnovers', 'Drives']);
        expect(away.rows[0].delta).toBe(60);            // 120 - 60
        expect(away.rows[2].selected).toBeCloseTo(45);  // 0.45 -> 45%
        expect(away.rows[2].delta).toBe(0);
        expect(c.teams[1].rows.every((r) => r.delta === 0)).toBe(true);
        expect(c.firstDifferingPlayId).toBeNull();
    });

    test('a missing ESPN side yields no delta rather than a wrong one', () => {
        const c = compareSources(payload(1, ['a']), null);
        expect(c.teams[0].rows.every((r) => r.espn === null && r.delta === null)).toBe(true);
        expect(c.playsEspn).toBe(0);
        expect(c.firstDifferingPlayId).toBe('a');
    });

    test('the first play id that disagrees is reported, in order', () => {
        const c = compareSources(payload(1, ['a', 'b', 'c']), payload(1, ['a', 'x', 'c']));
        expect(c.firstDifferingPlayId).toBe('b');
        expect(c.playsSelected).toBe(3);
    });
});
