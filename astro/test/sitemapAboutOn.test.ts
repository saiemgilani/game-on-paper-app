import { describe, expect, test, vi } from 'vitest';

// The sitemap once the About page is promoted ('about-page': 'on'). Its own file
// so the promotion path stays tested while the flag is 'preview'.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, 'about-page': 'on' } };
});

import { GET } from '../src/pages/sitemap.xml';

const xml: string = await ((GET as any)({} as any) as Response).text();

describe('sitemap.xml with the about-page flag on', () => {
    // server-rendered, so it answers on the bare path (no prerender redirect)
    test('lists /about once', () => {
        expect(xml.match(/<loc>https:\/\/gameonpaper\.com\/about<\/loc>/g)).toHaveLength(1);
    });
});
