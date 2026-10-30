// With the wbb flag public, the sitemap lists the scoreboard only: /wbb is a 302 to it until plan #11's teams index, and WBB has no
// team pages yet (hasTeamPages false), so no /wbb/team/ URL.
import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, wbb: 'on' } };
});

import { hasTeamPages } from '../src/basketball/config';
import { GET } from '../src/pages/sitemap.xml';

describe('sitemap.xml with wbb public', async () => {
    const xml = await ((GET as any)({} as any) as Response).text();
    test('the scoreboard, not the /wbb redirect, no team page', () => {
        const wbb = [...xml.matchAll(/<loc>(https:\/\/gameonpaper\.com\/wbb[^<]*)<\/loc>/g)].map((m) => m[1]);
        expect(wbb).toEqual(['https://gameonpaper.com/wbb/scoreboard']);
        expect(hasTeamPages('wbb')).toBe(false);
        expect(xml).not.toContain('/wbb/team/');
    });
});
