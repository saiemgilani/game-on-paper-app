// With the wbb flag public, the sitemap lists the landing, the Header's pages and the 363 programs of 2025-26 (D38: the
// core list plus the six reclassifiers), never a player page, and stays inside the protocol's limits.
import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, wbb: 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';
import { WBB_MEMBERS_2026 } from '../src/nba/data/wbbMembers';

describe('sitemap.xml with wbb public', async () => {
    const xml = await ((GET as any)({} as any) as Response).text();
    test('the landing, the scoreboard, the four shooting pages', () => {
        for (const p of ['/wbb', '/wbb/scoreboard', '/wbb/players', '/wbb/teams', '/wbb/scatter', '/wbb/leaders']) expect(xml).toContain(`<loc>https://gameonpaper.com${p}</loc>`);
        expect(xml).not.toContain('/wbb/</loc>');
    });
    test('every program of 2025-26 by ESPN id, the reclassifiers included; no player page', () => {
        const ids = [...xml.matchAll(/gameonpaper\.com\/wbb\/team\/(\d+)</g)].map((m) => Number(m[1]));
        expect(ids.length).toBe(363);
        expect(ids).toEqual([...WBB_MEMBERS_2026]); // D43/D47: exactly the committed 2026 member table, in its order (membership.test.ts pins it to the rule)
        for (const id of [88, 284, 2330, 2511, 2815, 2837, 2130, 2385, 2441]) expect(ids, String(id)).toContain(id);
        for (const id of [2697, 42]) expect(ids, String(id)).not.toContain(id);
        expect(xml).not.toContain('/wbb/players/');
    });
    test('inside the protocol limits', () => {
        const urls = (xml.match(/<url>/g) ?? []).length;
        console.log(`sitemap.xml with wbb on: ${urls} URLs, ${Buffer.byteLength(xml)} bytes`); // record in the PR body
        expect(urls).toBeLessThanOrEqual(50000);
        expect(Buffer.byteLength(xml)).toBeLessThanOrEqual(50 * 1024 * 1024);
    });
});
