import { describe, expect, test, vi } from 'vitest';

// The sitemap once the NBA is promoted ('nba': 'on'): the fixed pages and the 30 team pages.
// Player pages are deliberately absent: this file is prerendered and makes no network calls,
// and the player ids live in the Data API. Its own file so the promotion path stays tested
// while the flag is 'preview'.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, nba: 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';
import { TEAMS } from '../src/nba/data/teams';

const xml: string = await ((GET as any)({} as any) as Response).text();

describe('sitemap.xml with the nba flag on', () => {
  test('lists the six fixed pages and every team page, and no player page', () => {
    for (const p of ['/nba', '/nba/scoreboard', '/nba/players', '/nba/teams', '/nba/scatter', '/nba/leaders']) {
      expect(xml).toContain(`<loc>https://gameonpaper.com${p}</loc>`);
    }
    expect(TEAMS.length).toBe(30);
    for (const t of TEAMS) expect(xml).toContain(`<loc>https://gameonpaper.com/nba/team/${t.team_id}</loc>`);
    expect(xml).not.toContain('gameonpaper.com/nba/players/');
    expect(xml).not.toContain('/nba/</loc>');
  });
});
