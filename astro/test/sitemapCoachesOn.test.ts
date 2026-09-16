import { describe, expect, test, vi } from 'vitest';

// The sitemap once the head-coach boards are promoted ('coaches': 'on') while the
// NFL is still in preview: every cfb board for every finished season plus the
// careers boards, and still no /nfl URL. Its own file so the promotion path stays
// tested while the flag is 'preview'.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, coaches: 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';
import { AVAILABLE_SEASONS, CURRENT_YEAR } from '../src/utils/constants';
import { COACH_BOARD_SLUGS } from '../src/utils/coaches';

const xml: string = await ((GET as any)({} as any) as Response).text();

describe('sitemap.xml with the coaches flag on', () => {
  // The head-coach boards mirror the team categories: every board for every
  // finished season, plus the careers boards; /coaches and /year/N/coaches are
  // redirects to the default board and must not appear.
  test('lists every coach board per season and the careers boards', () => {
    expect(COACH_BOARD_SLUGS).toContain('pace');
    expect(COACH_BOARD_SLUGS).toContain('fourth-downs');
    for (const b of COACH_BOARD_SLUGS) {
      expect(xml).toContain(`<loc>https://gameonpaper.com/year/2025/coaches/${b}</loc>`);
      expect(xml).toContain(`<loc>https://gameonpaper.com/year/${AVAILABLE_SEASONS[0]}/coaches/${b}</loc>`);
      expect(xml).toContain(`<loc>https://gameonpaper.com/coaches/${b}</loc>`);
    }
    expect(AVAILABLE_SEASONS[0]).toBe(2004);
    expect(xml).not.toContain(`/year/${AVAILABLE_SEASONS[0] - 1}/coaches/`);
    expect(xml).not.toContain(`/year/${CURRENT_YEAR}/coaches`);
    expect(xml).not.toContain('<loc>https://gameonpaper.com/coaches</loc>');
    expect(xml).not.toContain('<loc>https://gameonpaper.com/year/2025/coaches</loc>');
    expect(xml).not.toContain('/coaches/pace/</loc>');
    const m = xml.match(/<loc>https:\/\/gameonpaper\.com\/year\/2015\/coaches\/pace<\/loc><lastmod>([^<]+)</);
    expect(m?.[1]).toBe('2016-01-15');
  });

  test('the NFL coach boards stay out while the nfl flag is not public', () => {
    expect(xml).not.toContain('gameonpaper.com/nfl');
  });
});
