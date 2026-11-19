import { describe, expect, test, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_KEY_PARAMS, keyedRequest } from '../src/utils/cacheKey';

// The Workers cache keys on path + query, so an unread parameter (#480: the stat card's `v` day bucket) was a
// miss and a render per value. worker.ts keys every page request on keyedRequest's URL.
const keyed = (u: string, init?: RequestInit) => keyedRequest(new Request(`https://gameonpaper.com${u}`, init)).url.replace('https://gameonpaper.com', '');

describe('keyedRequest', () => {
    test("drops the stat card's day bucket and any other unread parameter", () => {
        expect(keyed('/nba/players/1628983/card.png?season=2026&v=2026-11-19')).toBe('/nba/players/1628983/card.png?season=2026');
        expect(keyed('/year/2025/team/61?x=1&utm_source=x&fbclid=abc')).toBe('/year/2025/team/61?x=1');
        expect(keyed('/game/401856682?cachebust=123')).toBe('/game/401856682');
    });
    test('keeps every read parameter, in name order, repeated values in their order', () => {
        expect(keyed('/nba/team/2?season=2026&s=9&p=3&p=1&side=defense')).toBe('/nba/team/2?p=3&p=1&s=9&season=2026&side=defense');
        expect(keyed('/game/matchup?homeTeamId=59&awaySeason=2026')).toBe('/game/matchup?awaySeason=2026&homeTeamId=59');
        expect(keyed('/game/401856682?flags=bball-poe:on&view=public&source=shield&preview_key=k')).toBe('/game/401856682?flags=bball-poe%3Aon&preview_key=k&source=shield&view=public');
    });
    test("leaves Astro's endpoints, /admin, /pro and non-GET requests as sent", () => {
        for (const u of ['/_server-islands/X?e=1&p=2&z=3', '/admin/api/purge-game?ids=1&z=1', '/pro/portal?metric=rapm&z=1'])
            expect(keyed(u)).toBe(u);
        expect(keyed('/api/search?z=1', { method: 'POST', body: 'x' })).toBe('/api/search?z=1');
        expect(keyed('/nba')).toBe('/nba');
    });
    test('keeps the headers (cookies carry the admin session and preview flags)', () => {
        const r = keyedRequest(new Request('https://gameonpaper.com/nba?z=1', { headers: { cookie: 'gop_admin=1' } }));
        expect(r.headers.get('cookie')).toBe('gop_admin=1');
    });
});

// The guard on the list: every parameter name a page reads must be kept, or that page would render its default
// for every value. Scans src/ for literal searchParams reads and the *_PARAM constants; /admin and /pro are not
// keyed (above), so their reads are skipped.
describe('CACHE_KEY_PARAMS covers every parameter src/ reads', () => {
    const src = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(ts|astro|svelte)$/.test(f) && files.push(p); });
    walk(src);
    const scanned = files.filter((f) => !/\/pages\/(admin|pro)\//.test(f.replaceAll('\\', '/')));
    const names = new Map<string, string>();
    const read = /\b(?:searchParams|sp|q|query|params)\.(?:get|has|getAll)\(\s*['"]([\w-]+)['"]/g;
    const constant = /export const \w+_PARAM = ['"]([\w-]+)['"]/g;
    for (const f of scanned) {
        const text = readFileSync(f, 'utf8');
        // client-side reads (window.location) see the browser's URL, not the keyed one, and are skipped
        for (const re of [read, constant]) for (const m of text.matchAll(re)) names.set(m[1], f.slice(src.length));
    }
    for (const m of readFileSync(join(src, 'basketball/shotFilters.ts'), 'utf8').matchAll(/'(shot_\w+)'/g)) names.set(m[1], 'basketball/shotFilters.ts');

    test('the scan finds the reads it is meant to (a broken regex would pass vacuously)', () => {
        for (const n of ['season', 'awaySeason', 'shot_zone', 'order', 'preview_key', 'flags', 'conference', 'impact']) expect(names.has(n), n).toBe(true);
    });
    test('every scanned name is kept', () => {
        const missing = [...names].filter(([n]) => !CACHE_KEY_PARAMS.has(n)).map(([n, f]) => `${n} (${f})`);
        expect(missing).toEqual([]);
    });
});

describe('worker.ts', () => {
    test('the default entrypoint hands the keyed request to the cached Site entrypoint', async () => {
        vi.resetModules();
        vi.doMock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
        const { default: worker } = await import('../src/worker');
        const fetch = vi.fn(async (r: Request) => new Response(r.url));
        const res = await worker.fetch!(new Request('https://gameonpaper.com/nba/team/2/card.png?season=2026&v=2026-11-19') as any, {} as Env, { exports: { Site: { fetch } } } as any);
        expect(await res.text()).toBe('https://gameonpaper.com/nba/team/2/card.png?season=2026');
    });
    test('wrangler.jsonc caches Site and not the default entrypoint', () => {
        const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
        expect(cfg).toMatch(/"default":\s*\{\s*"type":\s*"worker",\s*"cache":\s*\{\s*"enabled":\s*false\s*\}/);
        expect(cfg).toMatch(/"Site":\s*\{\s*"type":\s*"worker",\s*"cache":\s*\{\s*"enabled":\s*true\s*\}/);
    });
});
