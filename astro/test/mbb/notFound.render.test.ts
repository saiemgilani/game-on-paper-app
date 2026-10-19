// The Task 7 page wrappers answer an unknown id with Astro.rewrite('/404'): rendered here through the container (the 404
// page registered as its route), so the rewrite itself is exercised, not just its source text. A malformed id is the
// notFound the loaders answer before any API read.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import NotFound from '../../src/pages/404.astro';
import TeamPage from '../../src/pages/mbb/team/[id].astro';
import PlayerPage from '../../src/pages/mbb/players/[id].astro';

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create();
    container.insertPageRoute('/404', NotFound);
});

describe('an unknown MBB team or player id renders the site 404', () => {
    for (const [name, Page, path] of [['team', TeamPage, '/mbb/team/abc'], ['player', PlayerPage, '/mbb/players/abc']] as const) {
        test(name, async () => {
            const r = await container.renderToResponse(Page, { params: { id: 'abc' }, request: new Request(`https://gameonpaper.com${path}`), locals: { preview: true } as App.Locals });
            const html = await r.text();
            expect(html).toContain('This page could not be found.');
            expect(html).not.toContain('undefined');
            expect(r.status).toBe(404);
        });
    }
});
