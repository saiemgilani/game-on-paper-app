// With the nba flag still 'preview': an admin's ?flags=nba:on override shows the Header entry, a
// preview-cookie holder's football Header stays the cfb/nfl switch (isFeaturePublic, not isFeatureEnabled).
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../src/components/Header.astro';
import { FLAGS } from '../src/utils/features';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = (locals: object) => container.renderToString(Header, { locals: locals as App.Locals });

describe('Header with the nba flag in preview', () => {
    test('the flag is still preview', () => { expect(FLAGS.nba).toBe('preview'); });
    test('a cfb viewer with an admin nba:on override sees the NBA entry', async () => {
        expect(await render({ league: 'cfb', flagOverrides: { nba: true } })).toContain('href="/nba"');
    });
    test('a cfb viewer holding the preview cookie does not', async () => {
        expect(await render({ league: 'cfb', preview: true })).not.toContain('href="/nba"');
    });
});
