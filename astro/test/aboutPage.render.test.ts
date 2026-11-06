import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

// The About page's footer link, behind 'about-page'. No reads: the footer is static.
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

const footer = async (locals: Record<string, unknown>) => {
    const { default: Footer } = await import('../src/components/Footer.astro');
    return container.renderToString(Footer, { locals: locals as App.Locals });
};

describe('footer About link', () => {
    for (const league of ['cfb', 'nfl']) {
        test(`[${league}] flag off: no link, and the Glossary line runs straight into the standings line`, async () => {
            const html = await footer({ league });
            expect(html).not.toContain('/about');
            // Footer's scoped styles add a data-astro-cid-* attribute to every tag
            expect(html).toMatch(/our <a href="\/glossary"[^>]*>Glossary<\/a>\.<\/p>\s*<p[^>]*>See the current/);
        });
        test(`[${league}] preview: one link to /about, after the Glossary line`, async () => {
            const html = await footer({ league, preview: true });
            expect(html.match(/href="\/about"/g)).toHaveLength(1);
            expect(html).toMatch(/Glossary<\/a>\.<\/p>\s*<p[^>]*>Meet the team on our <a href="\/about"[^>]*>About<\/a> page\.<\/p>/);
        });
    }
});
