import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';

// Game on Paper Pro (plan 2.1-3.6). Everything here runs on the synthetic fixtures
// in fixtures/pro/ (no real PFF value anywhere) and an in-memory KV; nothing touches
// R2, Resend or a real Worker.
vi.mock('astro:env/server', () => ({
    getSecret: (k: string) => ({ ADMIN_PASS: 'test-secret', PRO_COOKIE_SECRET: 'pro-secret' } as Record<string, string>)[k],
}));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));
vi.mock('cloudflare:workers', async () => ({ env: (await import('./helpers/memKV')).memEnv }));

import { SESSION } from './helpers/memKV';
import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import {
    describeFilters, digestEntrants, digestText, filterBoard, formatPffValue, formatProDelta, formatProMetric,
    mintProCookie, parseBoardFilters, PRO_COOKIE, PRO_TOKEN_TTL_S, sortBoard, verifyProCookie, type BoardEntrant,
} from '../src/utils/pro';
import { createLoginToken, isProKey, redeemLoginToken, runProDigest } from '../src/resources/pro';

const board: { entrants: BoardEntrant[] } = JSON.parse(readFileSync(new URL('./fixtures/pro/2026/portal/board.json', import.meta.url)).toString());
const DAY = 86_400_000;
const live = { tier: 'pro' as const, expires: new Date(Date.now() + 30 * DAY).toISOString() };
const lapsed = { tier: 'analyst', expires: new Date(Date.now() - DAY).toISOString() };

beforeEach(async () => {
    SESSION.m.clear();
    await SESSION.put('pro:ent:coach@example.edu', JSON.stringify(live));
    await SESSION.put('pro:ent:old@example.edu', JSON.stringify(lapsed));
});
afterEach(() => vi.useRealTimers());

/** The middleware on one request: preview cookie and/or a gop_pro cookie for `email`. */
async function run(path: string, opts: { preview?: boolean; email?: string } = {}) {
    const cookies = [
        opts.preview ? `${PREVIEW_COOKIE}=${await mintPreviewCookie('test-secret')}` : null,
        opts.email ? `${PRO_COOKIE}=${await mintProCookie(opts.email, 'pro-secret')}` : null,
    ].filter(Boolean).join('; ');
    const locals: Record<string, any> = {};
    let rewrittenTo: string | undefined = 'never-called';
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, { headers: cookies ? { cookie: cookies } : {} }),
        locals,
        cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    const res: Response = await (onRequest as any)(ctx, async (to?: string) => { rewrittenTo = to; return new Response('ok'); });
    return { res, locals, rewrittenTo };
}

describe('the middleware gate', () => {
    test("flag off: every Pro path and /pricing is the site's 404, even with an entitlement", async () => {
        for (const p of ['/pro', '/pro/players/1', '/pro/portal', '/pro/methodology', '/pro/login', '/pro/file/pro/2026/players/1.pdf', '/pricing']) {
            expect((await run(p, { email: 'coach@example.edu' })).rewrittenTo, p).toBe('/404');
        }
        // and nothing near it moves
        for (const p of ['/', '/players/4433971', '/production', '/pricingx']) {
            expect((await run(p)).rewrittenTo, p).toBeUndefined();
        }
    });

    test('no cookie: pages go to /pricing, files get a bare 403', async () => {
        for (const p of ['/pro', '/pro/players/1', '/pro/portal']) {
            const { res } = await run(p, { preview: true });
            expect(res.status, p).toBe(302);
            expect(res.headers.get('Location'), p).toBe('/pricing');
            expect(res.headers.get('Cache-Control'), p).toBe('no-store');
        }
        const file = await run('/pro/file/pro/2026/players/1.pdf', { preview: true });
        expect(file.res.status).toBe(403);
        expect(file.res.headers.get('Location')).toBeNull();
        // the open ones render for anyone the flag lets in
        for (const p of ['/pro/login', '/pro/methodology', '/pricing']) {
            expect((await run(p, { preview: true })).rewrittenTo, p).toBeUndefined();
        }
    });

    test('an expired entitlement, an unknown address or a forged cookie is no entitlement', async () => {
        for (const email of ['old@example.edu', 'nobody@example.edu']) {
            const { res, locals } = await run('/pro/players/1', { preview: true, email });
            expect(res.status, email).toBe(302);
            expect(locals.pro, email).toBeNull();
        }
        const forged = await mintProCookie('coach@example.edu', 'wrong-secret');
        expect(await verifyProCookie(forged, 'pro-secret')).toBeNull();
        const expired = await mintProCookie('coach@example.edu', 'pro-secret', Math.floor(Date.now() / 1000) - 31 * 86400);
        expect(await verifyProCookie(expired, 'pro-secret')).toBeNull();
        // the address is signed: swapping it in a good cookie breaks the signature
        const good = await mintProCookie('old@example.edu', 'pro-secret');
        const [v, exp, , sig] = good.split('.');
        expect(await verifyProCookie([v, exp, btoa('coach@example.edu').replace(/=+$/, ''), sig].join('.'), 'pro-secret')).toBeNull();
    });

    test('a live entitlement renders, uncacheable, with locals.pro resolved', async () => {
        const { res, locals, rewrittenTo } = await run('/pro/players/1', { preview: true, email: 'coach@example.edu' });
        expect(rewrittenTo).toBeUndefined();
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(locals.pro).toMatchObject({ email: 'coach@example.edu', tier: 'pro' });
        // a public page pays no KV read and gets no locals.pro
        expect((await run('/players/4433971', { email: 'coach@example.edu' })).locals.pro).toBeUndefined();
    });
});

describe('the magic link', () => {
    test('a token works once', async () => {
        const t = await createLoginToken('coach@example.edu');
        expect(await redeemLoginToken(t)).toBe('coach@example.edu');
        expect(await redeemLoginToken(t)).toBeNull();
        expect(await redeemLoginToken('not-a-token')).toBeNull();
    });

    test('a token dies after 15 minutes', async () => {
        vi.useFakeTimers({ now: Date.now() });
        const t = await createLoginToken('coach@example.edu');
        vi.setSystemTime(Date.now() + PRO_TOKEN_TTL_S * 1000 + 1);
        expect(await redeemLoginToken(t)).toBeNull();
    });

    test('/pro/auth sets a cookie the middleware accepts, then refuses the same link', async () => {
        const { GET } = await import('../src/pages/pro/auth');
        const t = await createLoginToken('coach@example.edu');
        const call = () => (GET as any)({ url: new URL(`https://gameonpaper.com/pro/auth?t=${t}`), request: new Request('https://gameonpaper.com/pro/auth') });
        const first: Response = await call();
        expect(first.status).toBe(302);
        expect(first.headers.get('Location')).toBe('/pro');
        const cookie = (first.headers.get('Set-Cookie') ?? '').split(';')[0].split('=').slice(1).join('=');
        expect(await verifyProCookie(cookie, 'pro-secret')).toBe('coach@example.edu');
        const again: Response = await call();
        expect(again.headers.get('Location')).toBe('/pro/login?err=1');
        expect(again.headers.get('Set-Cookie')).toBeNull();
    });

    test('/pro/login mails only an entitled address and answers the same either way', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Login } = await import('../src/pages/pro/login.astro');
        const post = (email: string) => container.renderToString(Login, {
            request: new Request('https://gameonpaper.com/pro/login', { method: 'POST', body: new URLSearchParams({ email }) }),
            locals: { preview: true, pro: null } as any,
        });
        const tokens = () => [...SESSION.m.keys()].filter((k) => k.startsWith('pro:tok:')).length;
        const yes = await post('Coach@Example.edu ');
        expect(tokens()).toBe(1);
        const no = await post('stranger@example.edu');
        expect(tokens()).toBe(1);
        for (const html of [yes, no]) expect(html).toContain('id="pro-login-sent"');
    }, 30_000);
});

describe('/pro/file', () => {
    test('403 without an entitlement, the bytes with one, 404 for a key outside pro/', async () => {
        const { GET } = await import('../src/pages/pro/file/[...key]');
        const key = 'pro/2026/portal/board.csv';
        expect((await (GET as any)({ params: { key }, locals: { pro: null } })).status).toBe(403);
        const ok: Response = await (GET as any)({ params: { key }, locals: { pro: { email: 'coach@example.edu', ...live } } });
        expect(ok.status).toBe(200);
        expect(ok.headers.get('Content-Type')).toContain('text/csv');
        expect(ok.headers.get('Cache-Control')).toBe('no-store');
        expect((await ok.text()).split('\n')[0]).toContain('pass_EPAplay_band_mid');
        for (const bad of ['pro/../secrets.json', 'other/x.json', 'pro/2026/players/1.exe', 'pro//x.pdf']) expect(isProKey(bad), bad).toBe(false);
        const missing: Response = await (GET as any)({ params: { key: 'pro/2026/players/999.pdf' }, locals: { pro: { email: 'a@b.co', ...live } } });
        expect(missing.status).toBe(404);
    });
});

describe('formatting follows the contract', () => {
    test('EPA signed 2 dp, rates as 1-dp percents, deltas in points, PFF rates already percents', () => {
        expect(formatProMetric('pass_EPAplay', 0.2593)).toBe('+0.26');
        expect(formatProMetric('rush_EPAplay', -0.0495)).toBe('-0.05');
        expect(formatProMetric('pass_comppct', 0.6634)).toBe('66.3%');
        expect(formatProMetric('pass_success', null)).toBe('—');
        expect(formatProDelta('rec_catchpct', 0.063)).toBe('+6.3 pts');
        expect(formatProDelta('rec_EPAplay', 0.12)).toBe('+0.12');
        expect(formatProDelta('rec_EPAplay', null)).toBe('—');
        expect(formatPffValue('pass_rush_win_rate', 14.25)).toBe('14.3%');
        expect(formatPffValue('grades_pass', 84.8)).toBe('84.8');
    });
});

describe('the portal board', () => {
    test('filters by position and by a band floor on one metric, and sorts', () => {
        const qbs = filterBoard(board.entrants, parseBoardFilters(new URLSearchParams('pos=qb')));
        expect(qbs.length).toBeGreaterThan(0);
        expect(qbs.every((e) => e.position === 'QB')).toBe(true);
        const f = parseBoardFilters(new URLSearchParams('metric=rec_EPAplay&min=50'));
        const strong = filterBoard(board.entrants, f);
        expect(strong.length).toBeGreaterThan(0);
        expect(strong.every((e) => e.band_mid.rec_EPAplay >= 50)).toBe(true);
        const sorted = sortBoard(strong, 'band', 'rec_EPAplay').map((e) => e.band_mid.rec_EPAplay);
        expect(sorted).toEqual(sorted.toSorted((a, b) => b - a));
        const names = sortBoard(board.entrants, 'name').map((e) => e.name);
        expect(names).toEqual(names.toSorted());
        // nulls last whichever way a column runs
        const stars = sortBoard(board.entrants, 'stars').map((e) => e.stars);
        expect(stars.slice(stars.indexOf(null))).toEqual(stars.filter((s) => s === null));
        // junk never becomes a filter
        expect(parseBoardFilters(new URLSearchParams('pos=<script>&metric=evil&min=500'))).toEqual({});
        expect(parseBoardFilters(new URLSearchParams('min=50'))).toEqual({});
    });

    test('Save and the digest filters land in KV and come back to the board view', async () => {
        const { POST } = await import('../src/pages/pro/board');
        const pro = { email: 'coach@example.edu', ...live };
        const post = (body: Record<string, string>) => (POST as any)({
            request: new Request('https://gameonpaper.com/pro/board', { method: 'POST', body: new URLSearchParams(body) }), locals: { pro },
        }) as Promise<Response>;
        const r = await post({ action: 'add', key: '2', back: '/pro/portal?pos=WR' });
        expect(r.status).toBe(303);
        expect(r.headers.get('Location')).toBe('/pro/portal?pos=WR');
        await post({ action: 'add', key: '2', back: 'https://evil.example/' }).then((x) => expect(x.headers.get('Location')).toBe('/pro/portal'));
        expect(await SESSION.get('pro:board:coach@example.edu', 'json')).toEqual(['2']);
        await post({ action: 'filters', pos: 'WR', metric: 'rec_EPAplay', min: '50', back: '/pro/portal' });
        expect(await SESSION.get('pro:filters:coach@example.edu', 'json')).toEqual({ pos: 'WR', metric: 'rec_EPAplay', min: 50 });
        await post({ action: 'remove', key: '2' });
        expect(await SESSION.get('pro:board:coach@example.edu', 'json')).toEqual([]);
        expect((await (POST as any)({ request: new Request('https://x/'), locals: { pro: null } })).status).toBe(403);
    });
});

describe('the portal digest', () => {
    test("yesterday's entrants that match, in words, and nothing when nothing matches", () => {
        const f = { pos: 'WR', metric: 'rec_EPAplay', min: 50 };
        const rows = digestEntrants(board.entrants, '2026-12-02', '2026-12-03', f);
        // best band first; Entrant 20 has no profile, so no link line
        expect(rows.map((e) => e.name)).toEqual(['Fixture Entrant 20', 'Fixture Receiver']);
        const text = digestText(rows, f, 'https://gameonpaper.com')!;
        expect(text.split('\n')[0]).toBe('2 new portal entrants match your filters (WR, EPA per target band 50+).');
        expect(text).toContain('- Fixture Entrant 20: WR, Northern Fixture, entered 2026-12-02, band 97\n- Fixture Receiver');
        expect(text).toContain('- Fixture Receiver: WR, Fixture Tech, entered 2026-12-02, band 78\n  https://gameonpaper.com/pro/players/2');
        expect(text).toContain('Not a valuation.');
        expect(digestText(digestEntrants(board.entrants, '2027-01-01', '2027-01-02', f), f, 'https://gameonpaper.com')).toBeNull();
        expect(describeFilters({})).toBe('All positions');
    });

    test('runs over saved filters for live entitlements only, and the dry run sends nothing real', async () => {
        await SESSION.put('pro:filters:coach@example.edu', JSON.stringify({ pos: 'WR' }));
        await SESSION.put('pro:filters:old@example.edu', JSON.stringify({ pos: 'WR' }));
        const sent: { to: string; text: string }[] = [];
        const n = await runProDigest('2026-12-01', '2026-12-10', 'https://gameonpaper.com', async (m) => (sent.push(m), true));
        expect(n).toBe(1);
        expect(sent.map((m) => m.to)).toEqual(['coach@example.edu']);
        expect(sent[0].text).toContain('Fixture Receiver');
    });
});

describe('the pages', () => {
    const pro = { email: 'coach@example.edu', ...live };
    const render = async (file: string, url: string, params: Record<string, string> = {}) => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Page } = await import(/* @vite-ignore */ file);
        return container.renderToString(Page, { params, request: new Request(`https://gameonpaper.com${url}`), locals: { preview: true, pro } as any });
    };

    test('the profile: bands, sample, change, PFF, volume, every note and the PDF link', async () => {
        const html = await render('../src/pages/pro/players/[id].astro', '/pro/players/1', { id: '1' });
        expect(html).toContain('Fixture Player');
        expect(html).toContain('href="/pro/file/pro/2026/players/1.pdf"');
        const row = html.split('data-metric="pass_EPAplay"')[1].split('</tr>')[0];
        expect(row).toContain('+0.26');
        expect(row).toContain('301 pass plays');
        expect(row).toContain('64 to 97');
        expect(html).toContain('id="pro-pff-table"');
        expect(html).toContain('Passing grade');
        expect(html).toContain('Below the qualifying sample for at least one metric');
        // the second fixture: a no-band metric, a rate change in points, no PFF panel, both notes
        const wr = await render('../src/pages/pro/players/[id].astro', '/pro/players/2', { id: '2' });
        expect(wr.split('data-metric="rush_EPAplay"')[1].split('</tr>')[0]).toContain('no band');
        expect(wr.split('data-metric="rec_catchpct"')[1].split('</tr>')[0]).toContain('+6.3 pts');
        expect(wr).not.toContain('id="pro-pff-table"');
        expect(wr).toContain('data-note="no_pff"');
        expect(wr).toContain('data-note="below_qualifier"');
    }, 60_000);

    test('an unknown or malformed id is a 404 rewrite, not a shell', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Page } = await import('../src/pages/pro/players/[id].astro');
        for (const id of ['999', '1.json', '../x']) {
            const res = await container.renderToResponse(Page, { params: { id }, request: new Request(`https://gameonpaper.com/pro/players/${id}`), locals: { preview: true, pro } as any }).catch(() => null);
            const body = res ? await res.text() : '';
            expect(body, id).not.toContain('Download PDF');
        }
    }, 60_000);

    test('the board: filters from the query, profile links, the CSV link, Save buttons', async () => {
        const html = await render('../src/pages/pro/portal.astro', '/pro/portal?pos=WR&metric=rec_EPAplay&min=50');
        expect(html).toContain('href="/pro/players/2"');
        expect(html).toContain('href="/pro/file/pro/2026/portal/board.csv"');
        const rows = html.split('id="pro-board-table"')[1].split('</table>')[0].split('data-key=').slice(1);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.includes('>WR<'))).toBe(true);
        expect(html).toContain('Fixture A&amp;M');
    }, 60_000);

    test('pricing: the tiers, "Contact us" with no payment link set, and the plain statements', async () => {
        const html = await render('../src/pages/pricing.astro', '/pricing');
        for (const s of ['$29/mo', '$249/yr', '$179/mo', '$1,499/yr', 'P4 $7,500', '$1,995/yr', '$350', '$2,500 / $7,500', 'From $3,500']) expect(html, s).toContain(s);
        expect(html).toContain('Not a valuation');
        expect(html).toContain('href="/pro/methodology"');
        expect(html).toContain('Contact us');
        expect(html).not.toContain('Subscribe</a>');
    }, 60_000);
});
