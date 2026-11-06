import { describe, expect, test, vi } from 'vitest';

// Once 'wnba' is 'on' (after plan #6): its landing and the Header's pages; team pages too, since the WNBA has them (plan #6).
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, wnba: 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';

const xml: string = await ((GET as any)({} as any) as Response).text();

describe('sitemap.xml with the wnba flag on', () => {
    test('the landing, the Header pages and the fifteen team pages; never a player page', () => {
        for (const p of ['/wnba', '/wnba/scoreboard', '/wnba/players', '/wnba/teams', '/wnba/scatter', '/wnba/leaders']) expect(xml).toContain(`<loc>https://gameonpaper.com${p}</loc>`);
        expect(new Set([...xml.matchAll(/gameonpaper\.com\/wnba\/team\/(\d+)</g)].map((m) => m[1])).size).toBe(15);
        expect(xml).not.toContain('/wnba/</loc>');
        expect(xml).not.toContain('/wnba/players/'); // the sitemap makes no network calls, so no player ids
    });
});
