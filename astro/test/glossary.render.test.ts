import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import { generateGlossaryItems } from '../src/resources/glossary';
import { termSlug } from '../src/utils/seo';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

describe('glossary term anchors', () => {
    test('every term is an h3 carrying its slug id; the letter sections stay', async () => {
        const { default: Page } = await import('../src/pages/glossary.astro');
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/glossary/') });
        const terms = [...generateGlossaryItems().values()].flat();
        expect([...html.matchAll(/<h3 class="col-sm-3 glossary-term"/g)]).toHaveLength(terms.length);
        for (const t of terms) expect(html).toContain(`id="${termSlug(t.term)}"`);
        expect(html).not.toContain('<dt');
        expect(html).not.toContain('<dd');
        expect(html).toContain('id="glossary-section-S"');
        expect(html).toContain('"url":"https://gameonpaper.com/glossary/#havoc-rate"');
    });
    test('the term heading resets to the look of the <dt> it replaced', () => {
        const css = readFileSync(new URL('../public/assets/css/base.css', import.meta.url), 'utf8');
        const rule = css.match(/\.glossary-term\s*\{([^}]*)\}/)?.[1] ?? '';
        for (const decl of ['font-family: inherit', 'font-size: inherit', 'font-weight: 700', 'line-height: inherit', 'margin: 0']) {
            expect(rule).toContain(decl);
        }
    });
});
