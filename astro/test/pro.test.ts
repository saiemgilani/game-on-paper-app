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
    describeFilters, digestEntrants, digestText, filterBoard, formatOdds, formatPffValue, formatProDelta, formatProMetric,
    formatUsd, mintProCookie, parseBoardFilters, PRO_COOKIE, PRO_TOKEN_TTL_S, proAllows, sortBoard, verifyProCookie, type BoardEntrant,
} from '../src/utils/pro';
import { claimDownload, claimLoginSend, createLoginToken, isProKey, latestBoard, redeemLoginToken, runProDigest } from '../src/resources/pro';

const board: { entrants: BoardEntrant[] } = JSON.parse(readFileSync(new URL('./fixtures/pro/2026/portal/board.json', import.meta.url)).toString());
const DAY = 86_400_000;
const live = { tier: 'pro' as const, expires: new Date(Date.now() + 30 * DAY).toISOString(), addons: ['portal', 'dossier'] };
const analyst = { tier: 'analyst' as const, expires: new Date(Date.now() + 30 * DAY).toISOString() };
const lapsed = { tier: 'analyst', expires: new Date(Date.now() - DAY).toISOString() };

beforeEach(async () => {
    SESSION.m.clear();
    await SESSION.put('pro:ent:coach@example.edu', JSON.stringify(live));
    await SESSION.put('pro:ent:old@example.edu', JSON.stringify(lapsed));
    await SESSION.put('pro:ent:fan@example.com', JSON.stringify(analyst));
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

    test('/pro/auth: a GET (an email scanner) spends nothing; the POST sets a cookie once', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Auth } = await import('../src/pages/pro/auth.astro');
        const t = await createLoginToken('coach@example.edu');
        const locals = { preview: true, pro: null } as any;
        for (let i = 0; i < 2; i++) {
            const html = await container.renderToString(Auth, { request: new Request(`https://gameonpaper.com/pro/auth?t=${t}`), locals });
            expect(html).toContain('id="pro-auth-form"');
            expect(html).toContain(`value="${t}"`);
        }
        expect(SESSION.m.has(`pro:tok:${t}`)).toBe(true);
        // the token is in this page's URL: its POST must not carry it as a Referer into request_log
        const page = await container.renderToResponse(Auth, { request: new Request(`https://gameonpaper.com/pro/auth?t=${t}`), locals });
        expect(page.headers.get('Referrer-Policy')).toBe('no-referrer');
        const post = () => container.renderToResponse(Auth, {
            request: new Request('https://gameonpaper.com/pro/auth', { method: 'POST', body: new URLSearchParams({ t }) }), locals,
        });
        const first = await post();
        expect(first.status).toBe(303);
        expect(first.headers.get('Location')).toBe('/pro');
        const cookie = (first.headers.get('Set-Cookie') ?? '').split(';')[0].split('=').slice(1).join('=');
        expect(await verifyProCookie(cookie, 'pro-secret')).toBe('coach@example.edu');
        const again = await post();
        expect(again.headers.get('Location')).toBe('/pro/login?err=1');
        expect(again.headers.get('Set-Cookie')).toBeNull();
        // a link with no token says so and offers a new one
        expect(await container.renderToString(Auth, { request: new Request('https://gameonpaper.com/pro/auth'), locals }))
            .toContain('href="/pro/login"');
    }, 30_000);

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

    test("between windows the last cycle's board shows, and its season says which", async () => {
        expect((await latestBoard(2026))?.season).toBe(2026);   // this cycle's board exists: it wins
        const prior = await latestBoard(2027);                   // no 2027 board yet: last cycle's
        expect(prior?.season).toBe(2026);
        expect(prior?.board.entrants.length).toBe(board.entrants.length);
        expect(await latestBoard(2030)).toBeNull();
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

    test('the board: valuation columns, sort by projected value, live scarcity, its own backtest', async () => {
        const html = await render('../src/pages/pro/portal.astro', '/pro/portal?sort=projusd');
        const rows = html.split('id="pro-board-table"')[1].split('</table>')[0].split('data-key=').slice(1);
        expect(rows[0]).toContain('$1.90M');  // highest projected value first
        expect(rows[0]).toContain('66 <span');
        expect(rows[0]).toContain('71 · $2.10M');  // next season, actual
        expect(rows[1]).toContain('$420K');
        expect(html.split('id="pro-board-scarcity"')[1].split('</div>')[0]).toContain('QB 1.25');
        expect(html).toContain('id="pro-board-check-table"');
        expect(html).toContain('82%');
        expect(html).toContain('not deals');
    }, 60_000);

    test('pricing: the tiers, "Contact us" with no payment link set, and the plain statements', async () => {
        const html = await render('../src/pages/pricing.astro', '/pricing');
        for (const s of ['$29/mo', '$249/yr', '$179/mo', '$1,499/yr', 'P4 $7,500', '$1,995/yr', '$350', '$2,500 / $7,500', 'From $3,500']) expect(html, s).toContain(s);
        expect(html).toContain('never reported NIL deals');
        expect(html).toContain('href="/pro/methodology"');
        expect(html).toContain('Contact us');
        expect(html).not.toContain('Subscribe</a>');
    }, 60_000);

    test('the profile valuation panel: tiles, routes, rushing over expected, labelled as a model', async () => {
        const html = await render('../src/pages/pro/players/[id].astro', '/pro/players/1', { id: '1' });
        const panel = html.split('id="pro-value"')[1].split('id="pro-efficiency"')[0];
        for (const s of ['$2.50M', '$1.40M', '42.5 EPA over a backup', '31%', '12 equal entrants', 'class-year proxy']) {
            expect(panel, s).toContain(s);
        }
        expect(html).toContain('Model estimates at revenue-share rates, not reported deals.');
        expect(panel).toContain('HS 4★ by year 3: 12% hit, ~8 signees');
        expect(panel).toContain('61 carries');
        expect(panel).toContain('QB rushing: 12.3 EPA over expected');
        // a profile without a value block has no panel
        const wr = await render('../src/pages/pro/players/[id].astro', '/pro/players/2', { id: '2' });
        expect(wr).not.toContain('id="pro-value"');
    }, 60_000);

    test('the roster report: headlines first, units with strengths, departing, PDF and limits', async () => {
        const html = await render('../src/pages/pro/rosters/[id].astro', '/pro/rosters/1', { id: '1' });
        expect(html.indexOf('id="pro-headlines"')).toBeLessThan(html.indexOf('id="pro-units-table"'));
        expect(html).toContain('Fixture State: $4.24M');
        expect(html).toContain('href="/pro/file/pro/2026/rosters/1.pdf"');
        expect(html.split('data-unit="QB"')[1].split('</tr>')[0]).toContain('text-success');
        expect(html.split('data-unit="WR"')[1].split('</tr>')[0]).toContain('45%');
        expect(html).toContain('id="pro-departing-table"');
        expect(html.split('data-unit="QB"')[1].split('</tr>')[0]).toContain('55 <span');
        expect(html).toContain('Fixture limit two.');
        const index = await render('../src/pages/pro/rosters/index.astro', '/pro/rosters');
        expect(index).toContain('href="/pro/rosters/1"');
    }, 60_000);

    test('the position and market reports render; an unknown unit is a 404', async () => {
        const qb = await render('../src/pages/pro/positions/[unit].astro', '/pro/positions/QB', { unit: 'QB' });
        for (const s of ['Quarterbacks: fixture headline one.', '$5.09M', '+3.6 pts', 'href="/pro/file/pro/2026/positions/QB.pdf"']) expect(qb, s).toContain(s);
        const bt = qb.split('id="pro-backtest-table"')[1].split('</table>')[0];
        expect(bt.split('data-variant="base"')[1].split('</tr>')[0]).toContain('fw-bold');
        expect(qb).toContain('×1.39 for players who change teams');
        const market = await render('../src/pages/pro/market.astro', '/pro/market');
        for (const s of ['Tightest markets', 'Fixture Mover', '4.8%', 'href="/pro/file/pro/2026/market/market.pdf"']) expect(market, s).toContain(s);
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Page } = await import('../src/pages/pro/positions/[unit].astro');
        const res = await container.renderToResponse(Page, { params: { unit: 'K' }, request: new Request('https://gameonpaper.com/pro/positions/K'), locals: { preview: true, pro } as any }).catch(() => null);
        expect(res ? await res.text() : '').not.toContain('Download PDF');
    }, 60_000);
});

describe('valuation formatting', () => {
    test('model dollars and odds print like the PDFs', () => {
        expect(formatUsd(2_500_000)).toBe('$2.50M');
        expect(formatUsd(456_400)).toBe('$456K');
        expect(formatUsd(null)).toBe('—');
        expect(formatOdds(0.312)).toBe('31%');
        expect(formatOdds(undefined)).toBe('—');
    });
});

describe('Pro pages refuse to render without an entitlement on their own', () => {
    test.each(['index', 'players/[id]', 'portal', 'rosters/index', 'rosters/[id]', 'positions/[unit]', 'market'])('/pro/%s redirects to /pricing when locals.pro is null', async (page) => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const pages: Record<string, () => Promise<any>> = {
            index: () => import('../src/pages/pro/index.astro'),
            'players/[id]': () => import('../src/pages/pro/players/[id].astro'),
            portal: () => import('../src/pages/pro/portal.astro'),
            'rosters/index': () => import('../src/pages/pro/rosters/index.astro'),
            'rosters/[id]': () => import('../src/pages/pro/rosters/[id].astro'),
            'positions/[unit]': () => import('../src/pages/pro/positions/[unit].astro'),
            market: () => import('../src/pages/pro/market.astro'),
        };
        const Page = (await pages[page]()).default;
        const res = await container.renderToResponse(Page, {
            params: { id: '1', unit: 'QB' }, request: new Request('https://gameonpaper.com/pro/x'), locals: { preview: true, pro: null } as any,
        });
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/pricing');
    });
});

test('sign-in emails are limited to one per address per minute', async () => {
    expect(await claimLoginSend('coach@example.edu')).toBe(true);
    expect(await claimLoginSend('coach@example.edu')).toBe(false);
    expect(await claimLoginSend('other@example.edu')).toBe(true);
});

describe('tiers and add-ons (spec v2 section 3)', () => {
    test('what each entitlement unlocks', () => {
        const base = { expires: '2099-01-01T00:00:00Z' };
        const a = { ...base, tier: 'analyst' as const };
        const pro = { ...base, tier: 'pro' as const };
        expect(proAllows(a, '/pro/players/1')).toBe(true);
        expect(proAllows(a, '/pro/file/pro/2026/players/1.pdf')).toBe(true);
        expect(proAllows(a, '/pro/portal')).toBe(false);
        expect(proAllows(a, '/pro/board')).toBe(false);
        expect(proAllows(a, '/pro/file/pro/2025/portal/board.csv')).toBe(false);
        expect(proAllows({ ...a, addons: ['portal'] }, '/pro/portal')).toBe(true);
        expect(proAllows(a, '/pro/file/pro/2026/teams/52.pdf')).toBe(false);
        expect(proAllows(pro, '/pro/file/pro/2026/teams/52.pdf')).toBe(true);
        expect(proAllows(pro, '/pro/file/pro/coaches/kirk-ferentz.pdf')).toBe(false);
        expect(proAllows({ ...pro, addons: ['dossier'] }, '/pro/file/pro/coaches/kirk-ferentz.pdf')).toBe(true);
        // valuation reports: above Analyst; the methodology PDF and profile values are for every tier
        for (const path of ['/pro/rosters', '/pro/rosters/194', '/pro/positions/QB', '/pro/market', '/pro/file/pro/2026/rosters/194.pdf', '/pro/file/pro/2026/market/market.pdf']) {
            expect(proAllows(a, path), path).toBe(false);
            expect(proAllows(pro, path), path).toBe(true);
        }
        expect(proAllows(a, '/pro/file/pro/2026/valuation/valuation.pdf')).toBe(true);
        expect(proAllows(a, '/pro/rostersx')).toBe(true);
    });

    test('the middleware enforces them: pages to /pricing, files and board posts 403', async () => {
        const page = await run('/pro/portal', { preview: true, email: 'fan@example.com' });
        expect(page.res.status).toBe(302);
        expect(page.res.headers.get('Location')).toContain('/pricing');
        expect((await run('/pro/file/pro/2025/portal/board.csv', { preview: true, email: 'fan@example.com' })).res.status).toBe(403);
        expect((await run('/pro/players/1', { preview: true, email: 'fan@example.com' })).rewrittenTo).not.toBe('never-called');
        expect((await run('/pro/portal', { preview: true, email: 'coach@example.edu' })).rewrittenTo).not.toBe('never-called');
    });

    test('unknown add-on names in KV are ignored', async () => {
        await SESSION.put('pro:ent:x@example.com', JSON.stringify({ ...analyst, addons: ['portal-free', 'everything'] }));
        expect((await run('/pro/portal', { preview: true, email: 'x@example.com' })).res.status).toBe(302);
    });

    test('Analyst gets 10 PDFs a month; CSVs are not metered; everyone has a daily cap', async () => {
        const fan = { ...analyst, email: 'fan@example.com' };
        for (let i = 0; i < 10; i++) expect(await claimDownload(fan, `pro/2026/players/${i}.pdf`)).toBe(true);
        expect(await claimDownload(fan, 'pro/2026/players/11.pdf')).toBe(false);
        expect(await claimDownload(fan, 'pro/2026/players/11.json')).toBe(true);
        const coach = { ...live, email: 'coach@example.edu' } as any;
        await SESSION.put(`pro:dl:coach@example.edu:${new Date().toISOString().slice(0, 10)}`, '150');
        expect(await claimDownload(coach, 'pro/2026/players/1.pdf')).toBe(false);
    });
});
