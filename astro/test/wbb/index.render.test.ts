import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, test } from 'vitest';
import Page from '../../src/pages/wbb/index.astro';

describe('/wbb until plan #11', () => {
    const get = async (preview: boolean) => {
        const container = await AstroContainer.create();
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wbb'), locals: { preview } as App.Locals });
        return [res.status, res.headers.get('Location'), res.headers.get('Cache-Control')];
    };
    // self-review on #343: the league switch's /wbb is a preview viewer's way in; a public Location dropped them off the
    // uncacheable /preview surface onto a URL that can serve the cached gated 404
    test('a 302 to the scoreboard, never cached; a preview viewer stays on /preview', async () => {
        expect(await get(true)).toEqual([302, '/preview/wbb/scoreboard', 'no-store']);
        expect(await get(false)).toEqual([302, '/wbb/scoreboard', 'no-store']);
    });
});
