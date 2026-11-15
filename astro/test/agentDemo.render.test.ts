import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';

// /for/agents, behind 'agent-demo'. No reads: every link is built from the query string.
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

const render = async (query: string, locals: Record<string, unknown>) => {
    const { default: Page } = await import('../src/pages/for/agents.astro');
    return container.renderToString(Page, {
        request: new Request(`https://gameonpaper.com/for/agents${query}`),
        locals: { league: 'cfb', ...locals } as App.Locals,
    });
};

describe('/for/agents', () => {
    test('flag off: rewrites to the 404 page (the container has none, so the rewrite throws)', async () => {
        await expect(render('', {})).rejects.toThrow(/route \/404/);
    });

    test('preview, no query: links use the example player, season and team', async () => {
        const html = await render('', { preview: true });
        expect(html).toContain('href="/players/4428993?season=2025"');
        expect(html).toContain('href="/players/4428993"');
        expect(html).toContain('href="/players/compare?ids=4428993&amp;season=2025"');
        expect(html).toContain('href="/year/2025/team/59"');
        expect(html).toContain('href="/year/2025/players/receiving"');
        expect(html).toContain('id="agent-demo-coverage"');
    });

    test('preview, a client in the query: every link follows it', async () => {
        const html = await render('?player=4433971&season=2024&team=183', { preview: true });
        expect(html).toContain('href="/players/4433971?season=2024"');
        expect(html).toContain('href="/team/183"');
        expect(html).not.toContain('4428993');
    });

    test('preview, bad values: fall back to the example, never echoed', async () => {
        const html = await render('?player=%22%3E%3Cscript%3E&season=1850&team=abc', { preview: true });
        expect(html).toContain('href="/players/4428993?season=2025"');
        expect(html).toContain('id="agent-demo-player" name="player" value="4428993"');
        expect(html).not.toContain('"><script>');
        expect(html).not.toContain('1850');
        expect(html).not.toContain('abc');
    });
});
