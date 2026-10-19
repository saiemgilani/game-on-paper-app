import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, test } from 'vitest';
import Page from '../../src/pages/mbb/index.astro';

describe('/mbb until plan #9', () => {
    test('a 302 to the scoreboard, never cached', async () => {
        const container = await AstroContainer.create();
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/mbb'), locals: { preview: true } as App.Locals });
        expect([res.status, res.headers.get('Location'), res.headers.get('Cache-Control')]).toEqual([302, '/mbb/scoreboard', 'no-store']);
    });
});
