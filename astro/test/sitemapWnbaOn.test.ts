import { describe, expect, test, vi } from 'vitest';

// Once 'wnba' is 'on' (after plan #6): its landing and the Header's pages; team pages only when the league has them.
// /wnba is a 302 to the scoreboard until plan #6 makes it a page, which is why the flag stays 'preview' until then.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, wnba: 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';

const xml: string = await ((GET as any)({} as any) as Response).text();

describe('sitemap.xml with the wnba flag on', () => {
    test('the landing and the scoreboard; no team page while the WNBA has none', () => {
        for (const p of ['/wnba', '/wnba/scoreboard']) expect(xml).toContain(`<loc>https://gameonpaper.com${p}</loc>`);
        expect(xml).not.toContain('gameonpaper.com/wnba/team/');
        expect(xml).not.toContain('/wnba/</loc>');
    });
});
