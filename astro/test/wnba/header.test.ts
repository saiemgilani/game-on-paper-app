import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../../src/components/Header.astro';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

describe('the WNBA Header', () => {
    test('a basketball menu of Scoreboard only, no featured-team entry, a switch to every admitted league', async () => {
        const html = await container.renderToString(Header, { locals: { league: 'wnba', preview: true } as App.Locals });
        const items = [...html.matchAll(/<a href="(\/wnba[^"]*)" class="nav-link px-2 link-secondary">([^<]+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
        expect(items).toEqual(['Scoreboard /wnba/scoreboard']);
        expect(html).not.toContain('>Nets<');
        expect(html).toContain('title="Switch league"');
        for (const href of ['href="/"', 'href="/nfl"', 'href="/nba"']) expect(html).toContain(href);
    });
    test("a football viewer's Header does not offer the WNBA while it is in preview", async () => {
        const html = await container.renderToString(Header, { locals: { league: 'cfb', preview: true } as App.Locals });
        expect(html).not.toContain('href="/wnba"');
    });
});
