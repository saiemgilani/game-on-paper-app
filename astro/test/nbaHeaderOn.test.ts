// A football viewer's Header gains the NBA entry only once the flag is public: while it is
// 'preview' their Header is byte-identical to before the league existed (nflFlag.test.ts and
// nflScoreboard.render.test.ts pin that), and promotion is then the flag flip alone.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    // mutate in place (not a spread copy): isFeatureEnabled reads the module's own FLAGS binding
    (real.FLAGS as Record<string, string>).nba = 'on';
    return real;
});

import Header from '../src/components/Header.astro';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

describe('Header with the nba flag on', () => {
    test('a cfb viewer sees the NBA in the league menu beside the NFL (two others: the dropdown)', async () => {
        const html = await container.renderToString(Header, { locals: { league: 'cfb', preview: true } as App.Locals });
        expect(html).toContain('href="/nba"');
        expect(html).toContain('href="/nfl"');
        expect(html).toContain('title="Switch league"'); // two others: the dropdown, not the single anchor
    });
    test('a cfb viewer without the preview cookie still sees the NBA once it is on, and not the NFL', async () => {
        const html = await container.renderToString(Header, { locals: { league: 'cfb' } as App.Locals });
        expect(html).toContain('href="/nba"');
        expect(html).toContain('title="Switch to NBA"'); // one other: the single anchor
        expect(html).not.toContain('href="/nfl"');
    });
});
