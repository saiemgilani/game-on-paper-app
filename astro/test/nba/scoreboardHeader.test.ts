import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../../src/components/Header.astro';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

describe('the NBA header menu', () => {
    test('lists Scoreboard first, before Nets', async () => {
        const html = await container.renderToString(Header, { locals: { league: 'nba', preview: true } as App.Locals });
        const sb = html.indexOf('href="/nba/scoreboard"'), nets = html.indexOf('>Nets<');
        expect(sb).toBeGreaterThan(-1);
        expect(sb).toBeLessThan(nets);
    });
});
