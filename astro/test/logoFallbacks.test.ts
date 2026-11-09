import { expect, test } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import DarkModeLogos from '../src/components/DarkModeLogos.astro';
import { retryLightLogoOnce } from '../src/utils/league';

// an <img> stand-in that reads src back absolute, as a browser does, and counts assignments
const img = (src: string, base = 'https://gameonpaper.com/wnba/game/1') => {
    let value = new URL(src, base).href, sets = 0;
    return { get src() { return value; }, set src(v: string) { sets++; value = new URL(v, base).href; }, get sets() { return sets; } };
};
const BASE = 'https://gameonpaper.com/wnba/game/1';

test('a failed hosted light logo is not re-requested (no retry loop)', () => {
    const i = img('/assets/img/wnba/cle.png');
    retryLightLogoOnce(i, '/assets/img/wnba/cle.png', BASE);
    expect(i.sets).toBe(0);
});

test('a failed dark logo falls back to the light one exactly once', () => {
    const i = img('https://a.espncdn.com/i/teamlogos/wnba/500-dark/atl.png');
    const light = 'https://a.espncdn.com/i/teamlogos/wnba/500/atl.png';
    retryLightLogoOnce(i, light, BASE);
    retryLightLogoOnce(i, light, BASE); // the light one fails too: stop
    expect(i.sets).toBe(1);
    expect(i.src).toBe(light);
});

test('a site-hosted WNBA dark logo is served as-is, not through the ESPN combiner', async () => {
    const container = await AstroContainer.create();
    const css = await container.renderToString(DarkModeLogos, { props: { teamIds: ['2', '20'] }, locals: { league: 'wnba' } as any });
    expect(css).toContain("img.team-logo-2 {\n        content: url('/assets/img/wnba/cle.png')");
    expect(css).toContain("content: url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/wnba/500-dark/atl.png&h=120&w=120')");
});

test('football dark logos are unchanged (still through the combiner)', async () => {
    const container = await AstroContainer.create();
    const css = await container.renderToString(DarkModeLogos, { props: { teamIds: ['333'] }, locals: { league: 'cfb' } as any });
    expect(css).toContain("content: url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500-dark/333.png&h=120&w=120')");
});
