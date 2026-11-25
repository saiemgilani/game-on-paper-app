import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import SiteIcons from '../src/components/SiteIcons.astro';

// #142: the home-screen icons. Every page shell renders SiteIcons (the
// basketball byte-identity snapshots pin it in GenericPage, the game shells
// and the scoreboard); this pins what it links and that the targets exist.
const pub = (p: string) => new URL(`../public${p}`, import.meta.url);

describe('site icons', () => {
    test('the head links the favicon, the iOS icon and the manifest', async () => {
        const container = await AstroContainer.create();
        const html = await container.renderToString(SiteIcons);
        expect(html).toContain('<link rel="icon" type="image/x-icon" href="/assets/img/favicon.ico">');
        expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/assets/img/apple-touch-icon.png">');
        expect(html).toContain('<link rel="manifest" href="/site.webmanifest">');
        for (const href of html.matchAll(/href="([^"]+)"/g)) expect(existsSync(pub(href[1])), href[1]).toBe(true);
    });

    test('the manifest names the site and its 192/512 icons, which exist at their stated size', () => {
        const manifest = JSON.parse(readFileSync(pub('/site.webmanifest'), 'utf8'));
        expect(manifest.name).toBe('Game on Paper');
        expect(manifest.start_url).toBe('/');
        expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
        for (const icon of manifest.icons) {
            const png = readFileSync(pub(icon.src));
            // PNG IHDR: width and height are the big-endian u32s at bytes 16 and 20
            expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
        }
    });
});
