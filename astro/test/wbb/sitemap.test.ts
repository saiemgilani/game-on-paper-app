import { describe, expect, test } from 'vitest';
import { GET } from '../../src/pages/sitemap.xml';
import { FLAGS } from '../../src/utils/features';

describe('sitemap.xml while wbb is in preview', () => {
    test('lists no /wbb URL (the flag really is preview here)', async () => {
        expect(FLAGS.wbb).toBe('preview');
        expect(await ((GET as any)({} as any) as Response).text()).not.toContain('gameonpaper.com/wbb');
    });
});
