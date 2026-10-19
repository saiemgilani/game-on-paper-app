import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, test } from 'vitest';
import Page from '../../src/pages/wnba/index.astro';

describe('/wnba until plan #6', () => {
    test('a 302 to the scoreboard, never cached', async () => {
        const container = await AstroContainer.create();
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wnba'), locals: { preview: true } as App.Locals });
        expect([res.status, res.headers.get('Location'), res.headers.get('Cache-Control')]).toEqual([302, '/wnba/scoreboard', 'no-store']);
    });
});
