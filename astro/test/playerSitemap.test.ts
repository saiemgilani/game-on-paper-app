import { beforeEach, describe, expect, test, vi } from 'vitest';

// The player sitemaps: /sitemap-index.xml lists /sitemap.xml plus one
// /sitemap-players-<league>-<season|career>-<page>.xml per PLAYER_SITEMAP_PAGE_SIZE
// URLs. 'nfl' is forced on here so the /nfl twin is covered while the flag is
// still 'preview'; playerSitemapFlags.test.ts pins the real flag state.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, nfl: 'on', 'player-pages': 'on' } };
});

let ids: Record<string, Map<number, string[]>> = {};
let fail = false;
const calls: string[] = [];
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayerSitemapIds: async (league: string) => {
        calls.push(league);
        if (fail) throw new Error('upstream down');
        return ids[league] ?? new Map();
    },
}));

import { GET as indexGET } from '../src/pages/sitemap-index.xml';
import { GET as playersGET } from '../src/pages/sitemap-players-[key].xml';
import { CURRENT_YEAR } from '../src/utils/constants';
import {
    PLAYER_SITEMAP_PAGE_SIZE, careerPlayerEntries, pageCount, pageSlice, parsePlayerSitemapKey,
    playerSitemapPath, seasonPlayerEntries, urlsetXml,
} from '../src/utils/sitemap';

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => String(from + i));
const BIG = PLAYER_SITEMAP_PAGE_SIZE + 1;

// a stand-in Workers Caching provider, so a test sees what each response asked of it
let cacheSets: unknown[] = [];
const cache = { set: (c: unknown) => { cacheSets.push(c); } };
const index = async () => (await (indexGET as any)({ cache }) as Response);
const players = async (key: string) => (await (playersGET as any)({ params: { key }, cache }) as Response);
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

beforeEach(() => {
    fail = false;
    calls.length = 0;
    cacheSets = [];
    ids = {
        // 2025 is one player over a page, so it pages; 4361214 played both seasons
        cfb: new Map([[2025, range(4_000_000, BIG)], [2024, ['4361214', '550577']]]),
        nfl: new Map([[2024, ['16800', '4361214']]]),
    };
});

describe('player sitemap keys', () => {
    test('round-trip through the path', () => {
        const k = { league: 'nfl' as const, season: 2024, page: 2 };
        expect(playerSitemapPath(k)).toBe('/sitemap-players-nfl-2024-2.xml');
        expect(parsePlayerSitemapKey('nfl-2024-2')).toEqual(k);
        expect(parsePlayerSitemapKey('cfb-career-1')).toEqual({ league: 'cfb', season: 'career', page: 1 });
    });

    test('anything the index never writes is not a key', () => {
        for (const k of ['cfb-2025-0', 'cfb-2025-01', 'cfb-25-1', 'mlb-2025-1', 'nba-2025-1', 'cfb-1990-1',
            'cfb-2025', 'cfb-2025-1.xml', '', undefined]) {
            expect(parsePlayerSitemapKey(k as any)).toBeNull();
        }
    });
});

describe('pagination', () => {
    test('pages cover every item once, in order, and nothing past the last page', () => {
        const items = range(1, 25);
        expect(pageCount(items.length, 10)).toBe(3);
        expect([1, 2, 3].flatMap((p) => pageSlice(items, p, 10)!)).toEqual(items);
        expect(pageSlice(items, 3, 10)).toHaveLength(5);
        expect(pageSlice(items, 4, 10)).toBeNull();
        expect(pageSlice(items, 0, 10)).toBeNull();
        expect(pageSlice([], 1, 10)).toBeNull();
        expect(pageCount(20, 10)).toBe(2);
    });

    test('a full page is inside the protocol limits (50,000 URLs, 50MB)', () => {
        expect(PLAYER_SITEMAP_PAGE_SIZE).toBeLessThanOrEqual(50_000);
        // the longest loc a player file can carry: an NFL season page with a 12-digit id
        const xml = urlsetXml(seasonPlayerEntries('nfl', 2025, Array(PLAYER_SITEMAP_PAGE_SIZE).fill('999999999999')));
        expect(new TextEncoder().encode(xml).length).toBeLessThan(50 * 1024 * 1024);
    });
});

describe('player URLs', () => {
    test('season pages carry ?season= and the league prefix; finished seasons are frozen', () => {
        const [cfb] = seasonPlayerEntries('cfb', 2024, ['4361214']);
        expect(cfb).toEqual({ loc: '/players/4361214?season=2024', lastmod: '2025-01-15', changefreq: 'yearly', priority: '0.4' });
        expect(seasonPlayerEntries('nfl', 2024, ['16800'])[0].loc).toBe('/nfl/players/16800?season=2024');
    });

    test('career pages list each player once, dated by his latest season', () => {
        const career = careerPlayerEntries('cfb', new Map([[2023, ['9', '10']], [2024, ['10']]]));
        expect(career.map((e) => [e.loc, e.lastmod])).toEqual([
            ['/players/9', '2024-01-15'],
            ['/players/10', '2025-01-15'],
        ]);
        const today = new Date().toISOString().slice(0, 10);
        const [current] = careerPlayerEntries('nfl', new Map([[CURRENT_YEAR, ['16800']]]));
        expect(current).toMatchObject({ loc: '/nfl/players/16800', lastmod: today, changefreq: 'weekly' });
    });
});

describe('/sitemap-index.xml', () => {
    test('lists the prerendered sitemap first, then every player file', async () => {
        const res = await index();
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/xml');
        const xml = await res.text();
        expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        expect(locs(xml)).toEqual([
            'https://gameonpaper.com/sitemap.xml',
            // 10,003 career players -> two career pages
            'https://gameonpaper.com/sitemap-players-cfb-career-1.xml',
            'https://gameonpaper.com/sitemap-players-cfb-career-2.xml',
            'https://gameonpaper.com/sitemap-players-cfb-2025-1.xml',
            'https://gameonpaper.com/sitemap-players-cfb-2025-2.xml',
            'https://gameonpaper.com/sitemap-players-cfb-2024-1.xml',
            'https://gameonpaper.com/sitemap-players-nfl-career-1.xml',
            'https://gameonpaper.com/sitemap-players-nfl-2024-1.xml',
        ]);
        expect(xml).toContain('<loc>https://gameonpaper.com/sitemap-players-cfb-2024-1.xml</loc><lastmod>2025-01-15</lastmod>');
    });

    test('every file it lists answers 200 with URLs, and its URL counts add up', async () => {
        const files = locs(await (await index()).text()).filter((l) => l.includes('sitemap-players-'));
        const urls: string[] = [];
        for (const f of files) {
            const res = await players(f.match(/sitemap-players-(.+)\.xml$/)![1]);
            expect(res.status, f).toBe(200);
            const page = locs(await res.text());
            expect(page.length).toBeGreaterThan(0);
            expect(page.length).toBeLessThanOrEqual(PLAYER_SITEMAP_PAGE_SIZE);
            urls.push(...page);
        }
        // cfb: 10,001 + 2 season URLs and as many careers (no one overlaps); nfl: 2 + 2
        expect(urls).toHaveLength(2 * (BIG + 2) + 4);
        expect(new Set(urls).size).toBe(urls.length);
    });

    test('a failed id read is an uncached 503, never a partial index', async () => {
        fail = true;
        const res = await index();
        expect(res.status).toBe(503);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(cacheSets).toEqual([false]);
    });
});

describe('/sitemap-players-<key>.xml', () => {
    test('a season page lists that season only, sorted as read', async () => {
        const xml = await (await players('cfb-2024-1')).text();
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
        expect(locs(xml)).toEqual([
            'https://gameonpaper.com/players/4361214?season=2024',
            'https://gameonpaper.com/players/550577?season=2024',
        ]);
        expect(calls).toEqual(['cfb']);
        expect(cacheSets).toEqual([expect.objectContaining({ maxAge: 86400, tags: ['sitemap'] })]);
    });

    test('the second page holds the overflow; past the last page is an uncached 404', async () => {
        expect(locs(await (await players('cfb-2025-2')).text())).toEqual([`https://gameonpaper.com/players/${4_000_000 + PLAYER_SITEMAP_PAGE_SIZE}?season=2025`]);
        const past = await players('cfb-2025-3');
        expect(past.status).toBe(404);
        expect(past.headers.get('Cache-Control')).toBe('no-store');
        expect(cacheSets.at(-1)).toBe(false);
    });

    test('the /nfl twin and its career page', async () => {
        expect(locs(await (await players('nfl-2024-1')).text())).toEqual([
            'https://gameonpaper.com/nfl/players/16800?season=2024',
            'https://gameonpaper.com/nfl/players/4361214?season=2024',
        ]);
        expect(locs(await (await players('nfl-career-1')).text())).toEqual([
            'https://gameonpaper.com/nfl/players/16800',
            'https://gameonpaper.com/nfl/players/4361214',
        ]);
    });

    test('a key it never writes is a 404 without a Data API read; a failed read is a 503', async () => {
        expect((await players('cfb-2025-01')).status).toBe(404);
        expect(calls).toEqual([]);
        expect(cacheSets).toEqual([false]);
        fail = true;
        expect((await players('cfb-2024-1')).status).toBe(503);
        expect(cacheSets).toEqual([false, false]);
    });
});
