// The WBB page wrappers answer an unknown id with Astro.rewrite('/404'): rendered here through the container (the 404
// page registered as its route), so the rewrite itself is exercised, not just its source text (plan #9's MBB pattern).
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import NotFound from '../../src/pages/404.astro';
import TeamPage from '../../src/pages/wbb/team/[id].astro';
import PlayerPage from '../../src/pages/wbb/players/[id].astro';

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create();
    container.insertPageRoute('/404', NotFound);
});

describe('an unknown WBB team or player id renders the site 404', () => {
    for (const [name, Page, path] of [['team', TeamPage, '/wbb/team/abc'], ['player', PlayerPage, '/wbb/players/abc']] as const) {
        test(name, async () => {
            const r = await container.renderToResponse(Page, { params: { id: 'abc' }, request: new Request(`https://gameonpaper.com${path}`), locals: { preview: true } as App.Locals });
            const html = await r.text();
            expect(html).toContain('This page could not be found.');
            expect(html).not.toContain('undefined');
            expect(r.status).toBe(404);
        });
    }
});
