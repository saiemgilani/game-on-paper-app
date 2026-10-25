// Final-review fix wave: NBA-own cache lifetimes, the real 2025-01-15 capture, and the render fixes.
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';

const kv = new Map<string, { value: string; ttl?: number }>();
const fetchMock = vi.fn();
vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')
        ? { get: async (key: string) => (kv.has(key) ? JSON.parse(kv.get(key)!.value) : null),
            getWithMetadata: async (key: string) => (kv.has(key) ? { value: JSON.parse(kv.get(key)!.value), metadata: { fetchedAt: Date.now() } } : { value: null }),
            put: async (key: string, value: string, opts?: { expirationTtl?: number }) => { kv.set(key, { value, ttl: opts?.expirationTtl }); } }
        : undefined) }),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), wrappedFetch: (...a: unknown[]) => fetchMock(...a) }));

const prep = vi.fn();
vi.mock('../../src/routes/nba/scoreboard', async (orig) => ({ ...(await orig<typeof import('../../src/routes/nba/scoreboard')>()), prepareNbaScoreboard: (...a: unknown[]) => prep(...a) }));

import Page from '../../src/pages/nba/scoreboard.astro';
import { BASKETBALL } from '../../src/basketball/config';

const realText = readFileSync(new URL('../fixtures/nba/scoreboard-20250115.json', import.meta.url)).toString();
const real = JSON.parse(realText);
const payload = (day: string) => new Response(JSON.stringify({ content: { sbData: { day: { date: day }, events: [{ id: '1', date: `${day}T23:00Z`, competitions: [{ competitors: [] }], status: { type: { name: 'STATUS_SCHEDULED' } } }] } } }), { status: 200 });

beforeEach(() => { kv.clear(); fetchMock.mockReset(); prep.mockReset(); });

describe('NBA cache lifetimes (SEASON_MODE is off in tests)', () => {
    test('live and non-past dated reads use the NBA 60 s refresh, not football season mode', async () => {
        fetchMock.mockResolvedValueOnce(payload('2026-10-10'));
        fetchMock.mockResolvedValueOnce(payload('2026-10-11'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        await getScoreboardForDay('nba', null);
        await getScoreboardForDay('nba', '20261011', {});
        expect(kv.get('scoreboard-day:nba')?.ttl).toBe(120);
        expect(kv.get('scoreboard-day:nba:20261011')?.ttl).toBe(120);
    });
    test('pastDay holds a day; an old pastDay holds 14 days', async () => {
        fetchMock.mockResolvedValueOnce(payload('2026-10-08'));
        fetchMock.mockResolvedValueOnce(payload('2025-04-15'));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        await getScoreboardForDay('nba', '20261008', { pastDay: true });
        await getScoreboardForDay('nba', '20250415', { pastDay: true, oldDay: true });
        expect(kv.get('scoreboard-day:nba:20261008')?.ttl).toBe(86400);
        expect(kv.get('scoreboard-day:nba:20250415')?.ttl).toBe(14 * 86400);
    });
    test('the live page policy is 60 s + swr 120', async () => {
        const { LIVE_SCOREBOARD_CACHE, OLD_DAY_CACHE } = await vi.importActual<typeof import('../../src/routes/nba/scoreboard')>('../../src/routes/nba/scoreboard');
        expect(LIVE_SCOREBOARD_CACHE).toMatchObject({ maxAge: 60, swr: 120 });
        expect(OLD_DAY_CACHE.maxAge).toBe(14 * 86400);
    });
});

describe('over the real ESPN capture (2025-01-15)', () => {
    test('fetch, sort, status and leaders read the real shapes', async () => {
        fetchMock.mockResolvedValueOnce(new Response(realText, { status: 200 }));
        const { getScoreboardForDay } = await import('../../src/resources/espn');
        const { sortScoreboard, statusLine, gameLeaders, toEspnDate } = await import('../../src/nba/scoreboard');
        const r = await getScoreboardForDay('nba', toEspnDate('2025-01-15'), { pastDay: true, oldDay: true });
        expect(r).toMatchObject({ day: '2025-01-15', degraded: false });
        expect(String(fetchMock.mock.calls[0][0])).toContain('date=20250115&');
        expect(r.events).toHaveLength(4);
        const games = sortScoreboard(r.events);
        const ot = games.find((g) => g.id === '401705127')!;
        expect(statusLine(ot.competitions[0].status)).toEqual({ kind: 'final', text: 'Final/OT' });
        expect(statusLine(games.find((g) => g.id === '401705128')!.competitions[0].status).text).toBe('Final');
        const ny = ot.competitions[0].competitors.find((c) => c.team.abbreviation === 'NY')!;
        expect(gameLeaders(ny)).toEqual({ pts: '38 J. Brunson', reb: '17 J. Hart', ast: '12 J. Hart' });
    });
});

describe('render', () => {
    let container: AstroContainer;
    // a preview header carries the search island, so the Svelte renderer is loaded
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = () => container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/scoreboard'), locals: { preview: true, league: 'nba' } as App.Locals });
    const base = { day: '2025-01-15', isLive: false, degraded: false, stale: false, undated: false, today: '2026-10-21',
        nav: { prev: '2025-01-14', next: '2025-01-16', label: 'Wednesday, January 15' }, games: [] as unknown[] };

    test('darkLogoCss: verified abbreviations only, ids numeric, nothing raw', async () => {
        const { darkLogoCss } = await import('../../src/nba/scoreboard');
        const css = darkLogoCss([{ id: '18', abbreviation: 'NY' }, { id: '26', abbreviation: 'UTAH' }, { id: '99', abbreviation: 'nzb' },
            { id: '5', abbreviation: "x';}</style>" }, { id: '1;x', abbreviation: 'ATL' }], BASKETBALL.nba.darkLogo);
        expect(css).toContain('img.team-logo-18{content:url(');
        expect(css).toContain('500-dark/ny.png');
        expect(css).toContain('500-dark/utah.png');
        for (const bad of ['nzb', 'team-logo-99', '</style>', '1;x']) expect(css).not.toContain(bad);
    });
    test('over the real capture: Final/OT, leaders, link, and odd-spelling dark logos', async () => {
        prep.mockResolvedValueOnce({ ...base, games: real.content.sbData.events });
        const html = await render();
        expect(html).toContain('Final/OT');
        expect(html).toContain('38 J. Brunson');
        expect(html).toContain('href="/nba/game/401705127"');
        expect(html).toContain('500-dark/ny.png');
        expect(html).toContain('500-dark/utah.png');
    });
    test('a non-NBA club on the page emits no dark rule', async () => {
        const ev = JSON.parse(JSON.stringify(real.content.sbData.events[1]));
        const away = ev.competitions[0].competitors[1];
        away.team.abbreviation = 'NZB'; away.id = '77';
        prep.mockResolvedValueOnce({ ...base, games: [ev] });
        const html = await render();
        expect(html).not.toContain('team-logo-77{');
        expect(html).not.toContain('nzb.png');
        expect(html).toContain('500-dark/tor.png');
    });
    test('a degraded page with no date says Scoreboard and hides prev/next', async () => {
        prep.mockResolvedValueOnce({ ...base, day: '2026-10-11', degraded: true, stale: true, undated: true, nav: { prev: '2026-10-10', next: '2026-10-12', label: 'Sunday, October 11' } });
        const html = await render();
        expect(html).toMatch(/<h1[^>]*>Scoreboard<\/h1>/);
        expect(html).not.toContain('October 11');
        expect(html).not.toContain('rel="prev"');
        expect(html).not.toContain('rel="next"');
        expect(html).toContain('scoreboard is unavailable');
    });
    test('a degraded dated page keeps its heading and navigation', async () => {
        prep.mockResolvedValueOnce({ ...base, degraded: true, stale: true });
        const html = await render();
        expect(html).toContain('Wednesday, January 15');
        expect(html).toContain('rel="prev"');
    });
    test('the date form has a Go submit button; the validity-guarded onchange stays', async () => {
        prep.mockResolvedValueOnce({ ...base });
        const html = await render();
        const form = /<form[^>]*action="\/nba\/scoreboard"[^>]*>([\s\S]*?)<\/form>/.exec(html)![1];
        const btn = /<button[^>]*>Go<\/button>/.exec(form)![0];
        expect(btn).toContain('type="submit"');
        expect(btn).toContain('btn btn-sm btn-outline-primary');
        expect(form).toContain('this.checkValidity()');
    });
});
