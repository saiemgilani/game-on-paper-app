import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hrefFor, rankHits, searchQuery, type SearchRow } from '../src/utils/search';

// The header search: the pure helpers, then the /api/search proxy with the Data API
// and KV mocked. The upstream body is a real `GET /v1/search?q=alab&league=cfb&types=
// team,player,game` response (captured 2026-10-07): six teams, a player and a game.
const ALAB: SearchRow[] = JSON.parse(readFileSync(new URL('./fixtures/search-alab-cfb.json', import.meta.url)).toString());

const seen: { url: string; init?: RequestInit }[] = [];
const kv = new Map<string, string>();
let kvDown = false;
let respond: () => Response = () => Response.json(ALAB);

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => { seen.push({ url: String(url), init }); return respond(); },
}));
vi.mock('cloudflare:workers', () => ({
    env: {
        SDV_API_CACHE: {
            get: async (k: string, type?: string) => {
                if (kvDown) throw new Error('KV unavailable');
                return kv.has(k) ? (type === 'json' ? JSON.parse(kv.get(k)!) : kv.get(k)) : null;
            },
            put: async (k: string, v: string) => { kv.set(k, v); },
        },
    },
}));

beforeEach(() => {
    seen.length = 0;
    kv.clear();
    kvDown = false;
    respond = () => Response.json(ALAB);
});

const row = (type: string, score: number, extra: Partial<SearchRow> = {}): SearchRow =>
    ({ type, id: String(Math.round(score * 1000)), label: `${type} ${score}`, sublabel: 'X · Y', league: 'cfb', score, ...extra });

describe('hrefFor', () => {
    test.each([
        [{ type: 'team', id: '333', league: 'cfb' }, '/team/333'],
        [{ type: 'team', id: '12', league: 'nfl' }, '/nfl/team/12'],
        [{ type: 'game', id: '401856682', league: 'cfb' }, '/game/401856682'],
        [{ type: 'game', id: '401547753', league: 'nfl' }, '/nfl/game/401547753'],
        [{ type: 'player', id: '4433971', league: 'cfb' }, '/players/4433971'],
        [{ type: 'player', id: '3139477', league: 'nfl' }, '/nfl/players/3139477'],
    ] as const)('%o -> %s', (r, href) => expect(hrefFor(r)).toBe(href));
});

describe('rankHits', () => {
    const all = { players: true, nfl: true };

    test('teams first, then players, then games, each by score', () => {
        const rows = [row('player', 0.9), row('player', 0.8), row('game', 0.95), row('player', 0.7), row('team', 0.6), row('team', 0.5)];
        expect(rankHits(rows, all).map((h) => `${h.type} ${h.id}`))
            .toEqual(['team 600', 'team 500', 'player 900', 'player 800', 'player 700', 'game 950']);
    });

    test('12 rows cap at 8', () => {
        expect(rankHits(Array.from({ length: 12 }, (_, i) => row('team', 1 + i / 100)), all)).toHaveLength(8);
    });

    test('players:false drops every player; nfl:false drops every NFL row', () => {
        const rows = [row('player', 0.9), row('team', 0.8, { league: 'nfl' }), row('team', 0.7), row('game', 0.6, { league: 'nfl' })];
        expect(rankHits(rows, { players: false, nfl: true }).some((h) => h.type === 'player')).toBe(false);
        expect(rankHits(rows, { players: true, nfl: false }).map((h) => h.href)).toEqual(['/team/700', '/players/900']);
    });

    test('seasons, unknown leagues and non-numeric ids are never links', () => {
        const rows = [row('season', 3, { id: '2025' }), row('team', 2, { league: 'mlb' }), row('team', 1, { id: '/evil.example' })];
        expect(rankHits(rows, all)).toEqual([]);
    });

    test('the real alab rows: hrefs built by GOP, slashes for dots', () => {
        const hits = rankHits(ALAB, all);
        expect(hits[0]).toEqual({ type: 'team', id: '333', label: 'Alabama', sublabel: 'ALA / SEC', href: '/team/333' });
        expect(hits.map((h) => h.type)).toEqual(['team', 'team', 'team', 'team', 'team', 'team', 'player', 'game']);
        expect(hits.find((h) => h.type === 'player')).toMatchObject({ sublabel: 'UCF / 2008–2012', href: '/players/383842' });
        expect(hits.find((h) => h.type === 'game')).toMatchObject({ label: 'Alabama @ LSU', href: '/game/401856740' });
    });

    test("a meme-list team's own name is lowercased, as cleanField does", () => {
        const [hit] = rankHits([{ type: 'team', id: '61', label: 'Georgia', sublabel: 'UGA · SEC', league: 'cfb', score: 4 }], all);
        expect(hit.label).toBe('georgia');
    });
});

describe('searchQuery', () => {
    test.each([
        [null, null], ['a', null], ['  a  ', null], ['x'.repeat(65), null], ['a b', null],
        [' alab ', 'alab'], ['texas a', 'texas'], ['texas a&m', 'texas a&m'],
    ])('%o -> %o', (raw, q) => expect(searchQuery(raw)).toBe(q));
});

describe('GET /api/search', () => {
    const call = async (qs: string, locals: Record<string, unknown> = { preview: true }) => {
        const { GET } = await import('../src/pages/api/search');
        const url = new URL(`https://gameonpaper.com/api/search?${qs}`);
        return GET({ url, locals, request: new Request(url) } as any) as Promise<Response>;
    };

    test('404 without the flag, and no upstream call', async () => {
        const res = await call('q=alab&league=cfb', {});
        expect(res.status).toBe(404);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(seen).toHaveLength(0);
    });

    test.each(['q=a', `q=${'x'.repeat(65)}`, 'q=', 'q=alab&league=mlb'])('%s -> [] and no upstream call', async (qs) => {
        const res = await call(qs);
        expect(await res.json()).toEqual([]);
        expect(seen).toHaveLength(0);
    });

    test('an NFL query while the NFL is off -> [] and no upstream call', async () => {
        const res = await call('q=mahomes&league=nfl', { preview: true, flagOverrides: { nfl: false } });
        expect(await res.json()).toEqual([]);
        expect(seen).toHaveLength(0);
    });

    test('one upstream team row -> 200 with the GOP href', async () => {
        respond = () => Response.json([ALAB[0]]);
        const res = await call('q=alab&league=cfb');
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(await res.json()).toEqual([{ type: 'team', id: '333', label: 'Alabama', sublabel: 'ALA / SEC', href: '/team/333' }]);
    });

    test('the upstream URL and the bearer token', async () => {
        await call('q=alab&league=cfb');
        expect(seen).toHaveLength(1);
        expect(seen[0].url).toBe('https://data.sportsdataverse.org/v1/search?q=alab&league=cfb&types=team%2Cplayer%2Cgame');
        expect(new Headers(seen[0].init?.headers).get('Authorization')).toBe('Bearer test');
    });

    test('a second request for the same (league, query) is a KV hit; the drops apply per viewer after it', async () => {
        await call('q=alab&league=cfb');
        const res = await call('q=%20ALAB%20&league=cfb', { preview: true, flagOverrides: { 'player-pages': false } });
        expect(seen).toHaveLength(1);
        const hits: { type: string }[] = await res.json();
        expect(hits).toHaveLength(7);
        expect(hits.some((h) => h.type === 'player')).toBe(false);
    });

    test('a KV read failure is a cache miss: the Data API is still asked', async () => {
        kvDown = true;
        expect(await (await call('q=alab&league=cfb')).json()).toHaveLength(8);
        expect(seen).toHaveLength(1);
    });

    test('an upstream failure is [], not cached, and its message never reaches the client', async () => {
        respond = () => Response.json({ detail: 'search timed out; narrow the query' }, { status: 503 });
        const res = await call('q=alab&league=cfb');
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('[]');
        expect(kv.size).toBe(0);
        respond = () => Response.json(ALAB);
        expect(await (await call('q=alab&league=cfb')).json()).toHaveLength(8);
        expect(seen).toHaveLength(2);
    });
});
