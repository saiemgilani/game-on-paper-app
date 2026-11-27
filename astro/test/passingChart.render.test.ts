import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import { passDepthSplit } from '../src/utils/passDirection';

// The game page's Target Matrix rows carry ESPN's play-text depth split per league (utils/passDirection.ts
// passDepthSplit): 20 air yards in college, 16 in the NFL. The plays are a real NFL game's processed body
// (fixtures/game-401772944-nfl.json.gz, 52 charted attempts); the label follows the league, not the plays.
const plays = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-401772944-nfl.json.gz', import.meta.url))).toString()).plays;

describe('the Target Matrix depth labels', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create(); });
    const render = async (league?: 'cfb' | 'nfl') => {
        const { default: Chart } = await import('../src/components/game/metrics/PassingChart.astro');
        return container.renderToString(Chart, { props: league ? { plays, league } : { plays } });
    };
    const subs = (html: string) => [...html.matchAll(/<td class="tm-section-title">[\s\S]*?<strong>([^<]*)<\/strong>[\s\S]*?<small>([^<]*)<\/small>/g)]
        .map((m) => [m[1], m[2]]);

    test('college: deep is 20+ air yards, short anything under', async () => {
        expect(subs(await render('cfb'))).toEqual([['Deep', '20+ air yards'], ['Short', 'Under 20 air yards']]);
        // a caller that passes no league is the college page
        expect(subs(await render())).toEqual([['Deep', '20+ air yards'], ['Short', 'Under 20 air yards']]);
    });

    test('NFL: deep is 16+ air yards, short anything under', async () => {
        const html = await render('nfl');
        expect(subs(html)).toEqual([['Deep', '16+ air yards'], ['Short', 'Under 16 air yards']]);
        expect(html).not.toMatch(/0-12|12\+/);
        // NFL text has carried depth and direction for years: no 2025 claim
        expect(html).toContain('<caption>Built off ESPN&#39;s play-by-play text. Sacks and passes');
        expect(html).not.toContain('2025');
    });

    test('the college caption dates the text: depth and direction from 2025 Week 9 on', async () => {
        expect(await render('cfb')).toContain('<caption>Built off ESPN&#39;s play-by-play text, which carries depth and direction from 2025 Week 9 on. Sacks and passes');
    });

    test('the rush matrix makes no date claim: college text carries rush direction in 2004 and 2007-13 games too', async () => {
        const { default: Chart } = await import('../src/components/game/metrics/RushingChart.astro');
        const html = await container.renderToString(Chart, { props: { plays } });
        expect(html).toMatch(/<caption>Built off ESPN(&#39;|')s play-by-play text\. Rush attempts that lack direction information are not included\.<\/caption>/);
        expect(html).not.toContain('2025');
    });

    test('the split per league', () => {
        expect([passDepthSplit('cfb'), passDepthSplit('nfl')]).toEqual([20, 16]);
    });
});
