import { describe, expect, test } from 'vitest';
import { GET } from '../../src/pages/sitemap.xml';

describe('sitemap.xml while mbb is in preview', () => {
    test('lists no /mbb URL', async () => {
        expect(await ((GET as any)({} as any) as Response).text()).not.toContain('gameonpaper.com/mbb');
    });
});
