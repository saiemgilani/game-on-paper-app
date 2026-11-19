import { describe, expect, test, vi } from 'vitest';
import { memEnv, memKV, PRO_BUCKET } from './helpers/memKV';

// #335: an id purges its basketball pages too, not just /game and /nfl/game.
const ESPN_API_CACHE = memKV();
vi.mock('cloudflare:workers', () => ({ env: new Proxy(memEnv, { get: (t, k) => (k === 'ESPN_API_CACHE' ? ESPN_API_CACHE : t[k as string]) }) }));
import { POST } from '../src/pages/admin/api/purge-game';
import { settledKey } from '../src/resources/python';
import type { League } from '../src/utils/league';

const ID = '401772944';
const LEAGUES: League[] = ['cfb', 'nfl', 'nba', 'wnba', 'mbb', 'wbb'];

async function purge(query: string, fail?: string) {
    const invalidated: unknown[] = [];
    const res = await (POST as any)({
        url: new URL(`https://gameonpaper.com/admin/api/purge-game?${query}`),
        request: new Request(`https://gameonpaper.com/admin/api/purge-game?${query}`, { method: 'POST' }),
        locals: { adminAuthed: true, adminActor: 'saiem' },
        cache: { invalidate: async (o: any) => { if (fail && o.path === fail) throw new Error('cache down'); invalidated.push(o); }, set: () => {} },
    });
    return { res: res as Response, invalidated };
}

describe('purge-game ?ids=', () => {
    test("purges every league's game page and share card", async () => {
        const { res, invalidated } = await purge(`ids=${ID}`);
        expect(res.status).toBe(200);
        for (const p of ['', '/nfl', '/nba', '/wnba', '/mbb', '/wbb']) {
            expect(invalidated).toContainEqual({ path: `${p}/game/${ID}` });
            expect(invalidated).toContainEqual({ path: `${p}/game/${ID}/card.png` });
        }
    });

    test("resets every league's regression-guard mark (resources/espn.ts gamestate keys)", async () => {
        const keys = [`gamestate:${ID}`, ...LEAGUES.slice(1).map((lg) => `gamestate:${lg}:${ID}`)];
        for (const k of keys) await ESPN_API_CACHE.put(k, '{}');
        await purge(`ids=${ID}`);
        for (const k of keys) expect(await ESPN_API_CACHE.get(k)).toBeNull();
    });

    test("one league's failure still runs every other step, and reports the id as an error", async () => {
        const { res, invalidated } = await purge(`ids=${ID}`, `/game/${ID}`);
        expect((await res.json()).results[ID]).toBe('error: cache down');
        expect(invalidated).toContainEqual({ path: `/wbb/game/${ID}/card.png` });
        expect(invalidated).toHaveLength(11);
    });

    test("deletes every league's settled-final copy in R2 (#484)", async () => {
        for (const lg of LEAGUES) await PRO_BUCKET.put(settledKey(lg, ID), '{}');
        await purge(`ids=${ID}`);
        expect([...PRO_BUCKET.m.keys()]).toEqual([]);
    });
});

test('the basketball league tags are purgeable (every basketball page carries its slug)', async () => {
    const { res, invalidated } = await purge('tags=nba,wnba,mbb,wbb');
    expect(res.status).toBe(200);
    expect(invalidated).toEqual([{ tags: ['nba', 'wnba', 'mbb', 'wbb'] }]);
});
