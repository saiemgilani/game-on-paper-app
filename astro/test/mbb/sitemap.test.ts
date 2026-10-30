import { describe, expect, test } from 'vitest';
import { GET } from '../../src/pages/sitemap.xml';
import { FLAGS } from '../../src/utils/features';

describe('sitemap.xml while mbb is in preview', () => {
    test('lists no /mbb URL (the flag really is preview here; sitemapMbbOn.test.ts is the flag-on side)', async () => {
        expect(FLAGS.mbb).toBe('preview');
        expect(await ((GET as any)({} as any) as Response).text()).not.toContain('gameonpaper.com/mbb');
    });
});
