import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../src/components/Header.astro';
import { moveActive } from '../src/components/search/SiteSearch.svelte';

// The header search box renders only for a viewer with 'site-search' enabled: everyone
// else gets today's header, with no island at all.
let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const render = (locals: Record<string, unknown>, url = 'https://gameonpaper.com/') =>
    container.renderToString(Header, { request: new Request(url), locals: locals as unknown as App.Locals });

describe('Header search', () => {
    test('absent without the flag: no box, no island', async () => {
        const html = await render({});
        expect(html).not.toContain('id="site-search"');
        expect(html).not.toContain('astro-island');
    });

    test('preview: the box inside the collapsed nav, an island, a combobox wired to its list', async () => {
        const html = await render({ preview: true });
        expect(html).toContain('id="site-search"');
        expect(html).toContain('astro-island');
        // inside #navOptions, so on a phone it lives in the menu the toggle opens
        expect(html.split('id="navOptions"')[1]).toContain('id="site-search"');
        expect(html).toMatch(/<input[^>]*type="search"[^>]*role="combobox"/);
        expect(html).toContain('aria-controls="site-search-results"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('placeholder="Search"');
    });

    test('from sm to lg a magnifier button opens the same box as a panel; phones and xl show it inline', async () => {
        const html = await render({ preview: true });
        const button = html.match(/<button[^>]*aria-controls="site-search-form"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
        expect(button).toContain('class="btn btn-sm btn-outline-primary d-none d-sm-inline-block d-xl-none"');
        expect(button).toContain('aria-label="Open search"');
        expect(button).toContain('aria-expanded="false"');
        expect(button).toContain('bi bi-search');
        // one box, not a second copy for the panel: hidden from sm to lg until the button opens it
        expect(html.match(/id="site-search-input"/g)).toHaveLength(1);
        expect(html).toMatch(/<form[^>]*id="site-search-form"[^>]*class="d-sm-none d-xl-block"/);
    });

    test('the island searches the league the page is in', async () => {
        const html = await render({ preview: true, league: 'nfl' }, 'https://gameonpaper.com/nfl');
        expect(html).toMatch(/props="[^"]*league[^"]*nfl/);
    });
});

describe('moveActive', () => {
    test.each([
        [7, 1, 8, 0], [0, -1, 8, 7], [3, 1, 8, 4], [3, -1, 8, 2],
        [-1, 1, 8, 0], [-1, -1, 8, 7], [0, 1, 0, -1],
    ])('(%i, %i, %i) -> %i', (i, delta, n, want) => expect(moveActive(i, delta, n)).toBe(want));
});
