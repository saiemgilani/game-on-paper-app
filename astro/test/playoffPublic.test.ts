// /playoff is public ('playoff-projection': 'on'): every CFB viewer's Header lists it under
// Tools, cookie or not (the Header is on every cached page), and the sitemap advertises it.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../src/components/Header.astro';
import { GET as sitemap } from '../src/pages/sitemap.xml';
import { FLAGS } from '../src/utils/features';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('the playoff projection is public', () => {
    test('the flag is on', () => {
        expect(FLAGS['playoff-projection']).toBe('on');
    });
    test('a cfb viewer without the preview cookie finds it under Tools; an nfl viewer does not', async () => {
        const cfb = await container.renderToString(Header, { locals: { league: 'cfb' } as App.Locals });
        expect(cfb).toMatch(/<a href="\/playoff" class="dropdown-item">Playoff Projection<\/a>/);
        const nfl = await container.renderToString(Header, { locals: { league: 'nfl', preview: true } as App.Locals });
        expect(nfl).not.toContain('href="/playoff"');
    });
    test('the sitemap lists it, unslashed (an SSR route)', async () => {
        const xml = await ((sitemap as any)({} as any) as Response).text();
        expect(xml).toContain('<loc>https://gameonpaper.com/playoff</loc>');
    });
});
