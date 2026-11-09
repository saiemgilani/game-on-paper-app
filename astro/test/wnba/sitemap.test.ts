import { describe, expect, test } from 'vitest';
import { GET } from '../../src/pages/sitemap.xml';

describe('sitemap.xml while wnba is in preview', () => {
    test('lists no /wnba URL', async () => {
        const xml = await ((GET as any)({} as any) as Response).text();
        expect(xml).not.toContain('gameonpaper.com/wnba');
    });
});
