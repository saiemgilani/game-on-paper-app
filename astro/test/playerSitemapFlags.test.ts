import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// The player sitemaps under the REAL flags: 'player-pages' is 'on', 'nfl' is not,
// so the index carries cfb player files only and every /nfl player file is a 404.
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayerSitemapIds: async (_league: string, seasons: number[]) =>
        new Map(seasons.includes(2024) ? [[2024, ['4361214']]] : []),
}));

import { GET as indexGET } from '../src/pages/sitemap-index.xml';
import { GET as playersGET } from '../src/pages/sitemap-players-[key].xml';
import { FLAGS } from '../src/utils/features';

describe('player sitemaps under the shipped flags', () => {
    test('cfb files are listed, no /nfl file is', async () => {
        expect(FLAGS['player-pages']).toBe('on');
        const xml = await ((await (indexGET as any)({})) as Response).text();
        expect(xml).toContain('<loc>https://gameonpaper.com/sitemap.xml</loc>');
        expect(xml).toContain('sitemap-players-cfb-2024-1.xml');
        if (FLAGS['nfl'] !== 'on') {
            expect(xml).not.toContain('sitemap-players-nfl');
            expect(((await (playersGET as any)({ params: { key: 'nfl-2024-1' } })) as Response).status).toBe(404);
        }
    });

    test('robots.txt points crawlers at the index', () => {
        const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
        expect(robots.match(/^Sitemap: .+$/gm)).toEqual(['Sitemap: https://gameonpaper.com/sitemap-index.xml']);
    });
});
