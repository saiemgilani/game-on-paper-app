import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

// The individual player pages sit behind the 'player-pages' feature flag
// (utils/features.ts): middleware turns every /players route -- both leagues --
// into the site's 404 unless the viewer holds the preview cookie, AND the hrefs
// that reach them render only for such a viewer. A public link into a gated
// namespace is a link to a 404, which is worse than no link, so with the flag
// off the leaderboard and the game box must render exactly what they rendered
// before this change. Promotion is 'preview' -> 'on' and nothing else.
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-summaries-2025.json', import.meta.url)).toString());
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayerSummaries: async () => fx.passing,
    retrieveTeamSummaries: async () => fx.team_summaries,
    retrievePercentiles: async () => [],
}));

import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';
import { isPlayerPath } from '../src/utils/players';

async function run(path: string, cookie: string | null) {
    const locals: Record<string, unknown> = {};
    let rewrittenTo: string | undefined = 'never-called';
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, {
            headers: cookie ? { cookie: `${PREVIEW_COOKIE}=${cookie}` } : {},
        }),
        locals,
        cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    const res = await (onRequest as any)(ctx, async (to?: string) => { rewrittenTo = to; return new Response('ok'); });
    return { locals, res, rewrittenTo };
}

const PLAYER_PATHS = [
    '/players/4433971', '/players/4433971?season=2023',
    '/nfl/players/16800', '/nfl/players/00-0031381',
];

describe('the player-pages flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['player-pages']).toBe('preview');
        expect(isFeatureEnabled('player-pages', {})).toBe(false);
        expect(isFeatureEnabled('player-pages', { preview: true })).toBe(true);
    });

    test('a public viewer gets the 404 for every player route, and only those', async () => {
        for (const p of PLAYER_PATHS) {
            expect((await run(p, null)).rewrittenTo, p).toBe('/404');
        }
        // the season leaderboards those pages hang off are untouched
        for (const p of ['/', '/players', '/year/2025/players/passing', '/year/2024/players/receiving', '/game/401634304', '/playersx']) {
            expect((await run(p, null)).rewrittenTo, p).toBeUndefined();
        }
        // the NFL leaderboards are gated by the 'nfl' flag, not this one: a
        // preview viewer reaches them, and still does not reach /nfl/players
        const cookie = await mintPreviewCookie('test-secret');
        expect((await run('/nfl/year/2024/players/receiving', cookie)).rewrittenTo).toBeUndefined();
    });

    test('the preview cookie renders them, uncacheable, and /preview/... composes', async () => {
        for (const p of ['/players/4433971', '/nfl/players/16800']) {
            const { locals, res, rewrittenTo } = await run(p, await mintPreviewCookie('test-secret'));
            expect(locals.preview, p).toBe(true);
            expect(rewrittenTo, p).toBeUndefined();
            expect(res.headers.get('Cache-Control'), p).toBe('no-store');
        }
        const { rewrittenTo } = await run('/preview/players/4433971?season=2023', await mintPreviewCookie('test-secret'));
        expect(rewrittenTo).toBe('/players/4433971?season=2023');
        const bounced = await run('/preview/nfl/players/16800', null);
        expect(bounced.res.status).toBe(302);
        expect(bounced.res.headers.get('Location')).toBe('/nfl/players/16800');
    });

    test('isPlayerPath is segment-exact and never catches the leaderboards', () => {
        for (const p of PLAYER_PATHS) expect(isPlayerPath(p.split('?')[0]), p).toBe(true);
        for (const p of ['/year/2025/players', '/nfl/year/2025/players/passing', '/playersx/1', '/team/183']) {
            expect(isPlayerPath(p), p).toBe(false);
        }
    });

    test('/nfl/players redirects to the NFL passing leaderboard, as /players does for college', async () => {
        // Akshay on #267: it 404'd -- no index page, and the bare path was gated
        // as if it were a player page
        const { CURRENT_YEAR } = await import('../src/utils/constants');
        const container = await AstroContainer.create();
        const { default: Page } = await import('../src/pages/nfl/players/index.astro');
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/nfl/players') });
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe(`/nfl/year/${CURRENT_YEAR}/players/passing`);
        const cookie = await mintPreviewCookie('test-secret');
        expect((await run('/nfl/players', cookie)).rewrittenTo).toBeUndefined();
    }, 30_000);

    test('the sitemap lists no player URL while the flag is gated', async () => {
        const { GET } = await import('../src/pages/sitemap.xml');
        const xml = await (await (GET as any)({} as any)).text();
        // a player URL is /players/<espn id>; the /year/N/players/<category>
        // leaderboards it DOES list share the segment, so match on the id
        expect(xml).not.toMatch(/<loc>[^<]*\/players\/\d/);
        expect(xml).toContain('/year/2024/players/passing');
    }, 30_000);
});

describe('the links are gated with the pages', () => {
    const renderLeaderboard = async (league: 'cfb' | 'nfl', locals: Record<string, unknown>) => {
        const container = await AstroContainer.create();
        const { default: Table } = await import('../src/components/leaderboards/PlayerLeaderboardTable.astro');
        return container.renderToString(Table, {
            props: { season: 2025, category: 'passing', metric: 'TEPA' },
            request: new Request('https://gameonpaper.com/year/2025/players/passing'),
            locals: { league, ...locals },
        });
    };

    test('leaderboard: flag off renders the name cell byte-identically to before the change', async () => {
        const off = await renderLeaderboard('cfb', {});
        expect(off).not.toContain('/players/');
        // exactly the markup the cell had before PlayerLink wrapped it
        const name = fx.passing[0].passer_player_name;
        expect(off).toContain(`<td class="text-left" colspan="1"><strong>${name}</strong></td>`);
    }, 60_000);

    test('leaderboard: the preview viewer gets a link on the id the row carries', async () => {
        const nflOn = await renderLeaderboard('nfl', { preview: true });
        // the NFL season tables key on gsis; the route resolves it and redirects
        expect(nflOn).toContain(`href="/nfl/players/${fx.passing[0].player_id}?season=2025"`);
        expect(fx.passing[0].player_id).toMatch(/^\d{2}-\d{7}$/);
        // and the name is still bold inside the link -- the bolding is the
        // column's, not the link's
        expect(nflOn).toContain(`<strong>${fx.passing[0].passer_player_name}</strong></a>`);
    }, 60_000);

    test('the game usage box links its names only for a preview viewer', async () => {
        const container = await AstroContainer.create();
        const { default: Usage } = await import('../src/components/game/metrics/UsageBoxScore.astro');
        // the committed game fixtures predate usage_box, so this is a minimal
        // box: what matters is the id on the row, not the numbers around it
        const box = {
            player_usage: [{ pos_team: 183, player_id: '4433971', player_name: 'Kyle McCord', position_group: 'QB', opportunities: 5, rushes: 5, targets: 0, receptions: 0, touches: 5 }],
            tackles: [{ def_pos_team: 183, player_id: '4567890', player_name: 'A Defender', position_group: 'LB', tackles: 7, assists: 2, tackle_points: 8, team_tackle_points: 60, tackle_share: 0.13 }],
        } as any;
        const render = (locals: Record<string, unknown>) => container.renderToString(Usage, {
            props: { box, teamId: 183, season: 2024 },
            request: new Request('https://gameonpaper.com/game/401634304'),
            locals: { league: 'cfb', ...locals },
        });
        const off = await render({});
        expect(off).toContain('<td><b>Kyle McCord</b>');
        expect(off).not.toContain('/players/');
        const on = await render({ preview: true });
        expect(on).toContain('href="/players/4433971?season=2024"');
        expect(on).toContain('href="/players/4567890?season=2024"');
        expect(on).toContain('<b>Kyle McCord</b></a>');
    }, 60_000);

    test('a row with no usable id is never linked, flag on or off', async () => {
        const container = await AstroContainer.create();
        const { default: Link } = await import('../src/components/player/PlayerLink.astro');
        const render = (id: unknown, league: 'cfb' | 'nfl' = 'cfb') => container.renderToString(Link, {
            props: { id, season: 2024 },
            request: new Request('https://gameonpaper.com/'),
            locals: { league, preview: true },
            slots: { default: 'Name' },
        });
        for (const id of [null, undefined, '', 'Kyle McCord', '4433971.0']) {
            expect(await render(id), String(id)).not.toContain('<a ');
        }
        // a gsis id is linkable on the NFL twin (the route redirects it) and not on cfb
        expect(await render('00-0031381', 'nfl')).toContain('href="/nfl/players/00-0031381?season=2024"');
        expect(await render('00-0031381', 'cfb')).not.toContain('<a ');
    }, 60_000);
});
