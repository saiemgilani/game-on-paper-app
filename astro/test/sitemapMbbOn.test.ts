// With the mbb flag public, the sitemap lists the landing, the Header's pages and the 365 current-season members (D43/D47), never a
// player page, and the file stays inside the sitemap protocol's limits (50,000 URLs, 50 MiB uncompressed per file).
import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, mbb: 'on' } };
});

import { BASKETBALL } from '../src/basketball/config';
import { GET } from '../src/pages/sitemap.xml';

describe('sitemap.xml with mbb public', async () => {
    const xml = await ((GET as any)({} as any) as Response).text();
    test('the landing, the scoreboard, the four shooting pages', () => {
        for (const p of ['/mbb', '/mbb/scoreboard', '/mbb/players', '/mbb/teams', '/mbb/scatter', '/mbb/leaders']) expect(xml).toContain(`<loc>https://gameonpaper.com${p}</loc>`);
        expect(xml).not.toContain('/mbb/</loc>');
    });
    test('every current-season member team page, keyed by ESPN id; Hartford (no conference row) out; no player page', () => {
        const ids = [...xml.matchAll(/gameonpaper\.com\/mbb\/team\/(\d+)</g)].map((m) => Number(m[1]));
        expect(ids.length).toBe(365);
        expect(new Set(ids)).toEqual(new Set(BASKETBALL.mbb.currentMembers!.ids));
        for (const id of [88, 2511, 2815, 2697]) expect(ids, String(id)).toContain(id); // three D34 programs and West Florida, members in 2027
        for (const id of [42, 2598]) expect(ids, String(id)).not.toContain(id); // D43: every listed URL answers 200 (Saint Francis left D-I after 2026)
        expect(xml).not.toContain('/mbb/players/');
    });
    test('inside the protocol limits', () => {
        const urls = (xml.match(/<url>/g) ?? []).length;
        console.log(`sitemap.xml with mbb on: ${urls} URLs, ${Buffer.byteLength(xml)} bytes`); // record in the PR body
        expect(urls).toBeLessThanOrEqual(50000);
        expect(Buffer.byteLength(xml)).toBeLessThanOrEqual(50 * 1024 * 1024);
    });
});
