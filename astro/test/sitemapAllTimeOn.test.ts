import { describe, expect, test, vi } from 'vitest';

// The sitemap once the all-time boards are promoted ('all-time-leaderboards': 'on'),
// NFL still in preview: the three cfb boards, no /nfl one. Its own file so the
// promotion path stays tested while the flag is 'preview'.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, 'all-time-leaderboards': 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';

describe('sitemap.xml with the all-time-leaderboards flag on', () => {
    test('lists each cfb all-time board', async () => {
        const xml: string = await ((GET as any)({} as any) as Response).text();
        for (const c of ['passing', 'rushing', 'receiving']) {
            expect(xml).toContain(`<loc>https://gameonpaper.com/all-time/players/${c}</loc>`);
        }
        expect(xml).not.toContain('/nfl/all-time/');
    });
});
