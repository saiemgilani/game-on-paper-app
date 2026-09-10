import { describe, expect, test, vi } from 'vitest';

// The sitemap once the NFL is promoted ('nfl': 'on'): the /nfl season,
// leaderboard and team blocks mirror the cfb ones. Kept as its own file so the
// promotion path stays tested while the flag is still 'preview'.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, nfl: 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';
import { CURRENT_YEAR } from '../src/utils/constants';

const xml: string = await ((GET as any)({} as any) as Response).text();

describe('sitemap.xml with the nfl flag on', () => {
  test('the NFL mirrors the season, leaderboard and team blocks under /nfl', () => {
    expect(xml).toContain('<loc>https://gameonpaper.com/nfl</loc>');
    for (const c of ['differential', 'offensive', 'defensive', 'tendencies', 'fourth-downs', 'luck']) {
      expect(xml).toContain(`<loc>https://gameonpaper.com/nfl/year/2025/teams/${c}</loc>`);
    }
    expect(xml).toContain('<loc>https://gameonpaper.com/nfl/year/2025/players/passing</loc>');
    expect(xml).toContain('<loc>https://gameonpaper.com/nfl/teams</loc>');
    expect(xml).toContain('<loc>https://gameonpaper.com/nfl/team/12</loc>');
    expect(xml).toContain('<loc>https://gameonpaper.com/nfl/year/2002/team/12</loc>');
    expect(xml).toContain('<loc>https://gameonpaper.com/nfl/year/2020/type/2/week/17</loc>');
    expect(xml).not.toContain('/nfl/year/2020/type/2/week/18');
    // 2026 has no season table yet: no team-season page, and the leaderboards redirect
    expect(xml).not.toContain(`/nfl/year/${CURRENT_YEAR}/team/`);
    expect(xml).not.toContain(`/nfl/year/${CURRENT_YEAR}/teams`);
    // the rbsdm extras are NFL-only
    expect(xml).not.toContain('gameonpaper.com/year/2025/teams/tendencies</loc>');
  });

});
