// With the basketball flags still 'preview': a public football Header stays the cfb/nfl switch, an admin's
// ?flags=nba:on override shows the NBA entry, and a preview viewer (cookie or ?view=preview) sees every
// enabled league in the switch -- nba, wnba, mbb and wbb beside the nfl (BB-G31).
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../src/components/Header.astro';
import { FLAGS } from '../src/utils/features';

let container: AstroContainer;
// a preview header carries the search island, so the Svelte renderer is loaded
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = (locals: object) => container.renderToString(Header, { locals: locals as App.Locals });
const BASKETBALL = ['nba', 'wnba', 'mbb', 'wbb'] as const;

describe('Header with the basketball flags in preview', () => {
    test('the flags are still preview', () => {
        for (const lg of BASKETBALL) expect(FLAGS[lg]).toBe('preview');
    });
    test('a public cfb viewer sees no basketball league', async () => {
        const html = await render({ league: 'cfb' });
        for (const lg of BASKETBALL) expect(html).not.toContain(`href="/${lg}"`);
    });
    test('a cfb viewer with an admin nba:on override sees the NBA entry', async () => {
        expect(await render({ league: 'cfb', flagOverrides: { nba: true } })).toContain('href="/nba"');
    });
    test('a cfb viewer in preview mode sees all four basketball leagues and the NFL in the dropdown', async () => {
        const html = await render({ league: 'cfb', preview: true });
        for (const lg of [...BASKETBALL, 'nfl']) expect(html).toContain(`href="/${lg}"`);
        expect(html).toContain('title="Switch league"');
    });
    test('an nfl viewer in preview mode sees them too, and cfb', async () => {
        const html = await render({ league: 'nfl', preview: true });
        for (const lg of BASKETBALL) expect(html).toContain(`href="/${lg}"`);
        expect(html).toMatch(/class="dropdown-item" href="\/"/);
    });
    test('in preview mode an admin override that turns a league off still hides it', async () => {
        const html = await render({ league: 'cfb', preview: true, flagOverrides: { wbb: false } });
        expect(html).not.toContain('href="/wbb"');
        expect(html).toContain('href="/mbb"');
    });
});
