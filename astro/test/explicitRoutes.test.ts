import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// The NFL lives at explicit pages under src/pages/nfl/ that set the league and
// render the shared route components (review on #229: no middleware rewrite).
// This pins (1) that every league-aware cfb page has an nfl twin, (2) the
// page-side loaders' decisions, and (3) that an nfl page file end to end sets
// locals.league so the shared component renders NFL links and copy.
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-summaries-2025.json', import.meta.url)).toString());

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSummaries: async () => fx.team_summaries,
    retrievePlayerSummaries: async () => fx.passing,
    retrievePercentiles: async () => [],
}));

const PAGES = new URL('../src/pages/', import.meta.url).pathname;
function walk(dir: string, prefix = ''): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p, `${prefix}${f}/`) : [`${prefix}${f}`];
    });
}

describe('explicit /nfl pages', () => {
    test('every league-aware cfb page has an nfl twin, and nothing else lives under /nfl', () => {
        // pages with no league: admin/api/health/404/sitemap/glossary/changelog
        const leagueless = /^(admin|api|changelog|glossary|health|404|sitemap|nfl)(\/|\.)/;
        const cfb = walk(PAGES).filter((p) => !leagueless.test(p)).sort();
        const nfl = walk(join(PAGES, 'nfl')).sort();
        expect(nfl).toEqual(cfb);
    });

    test('a page handles every variant its loader can return', () => {
        // routes/*.ts loaders return {redirect}/{notFound} unions; a page that
        // forgets a branch spreads the marker object into the component and
        // ships an "undefined" page as HTTP 200 (seen on /year/2025junk/teams).
        const loaders = ['leaderboards', 'matchup', 'seasonTeam', 'game']
            .map((f) => readFileSync(new URL(`../src/routes/${f}.ts`, import.meta.url)).toString()).join('\n');
        const variants: Record<string, string[]> = {};
        for (const m of loaders.matchAll(/export (?:async )?function (\w+)\([\s\S]*?\n\}/g)) {
            variants[m[1]] = ['notFound', 'redirect'].filter((k) => m[0].includes(`{ ${k}`));
        }
        expect(variants.prepareLeaderboard).toEqual(['notFound', 'redirect']);
        for (const p of walk(PAGES)) {
            const src = readFileSync(join(PAGES, p)).toString();
            for (const [fn, keys] of Object.entries(variants)) {
                if (!src.includes(`${fn}(`)) continue;
                for (const k of keys) expect(src, `${p} handles '${k}' from ${fn}`).toContain(`'${k}' in r`);
            }
        }
    });

    test('an nfl page sets the league itself (no middleware)', () => {
        for (const p of walk(join(PAGES, 'nfl'))) {
            const src = readFileSync(join(PAGES, 'nfl', p)).toString();
            expect(src, p).toMatch(/'nfl'/);
        }
    });
});

function fakeAstro(path: string, params: Record<string, string>) {
    return { params, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any } as any;
}

describe('leaderboard loaders', () => {
    test('team category: unknown category is a 404, current season redirects, else params', async () => {
        const { prepareTeamCategory } = await import('../src/routes/leaderboards');
        const { CURRENT_YEAR, LAST_YEAR } = await import('../src/utils/constants');
        expect(prepareTeamCategory(fakeAstro('/nfl/year/2025/teams/bogus', { year: '2025', category: 'bogus' }), 'nfl')).toEqual({ notFound: true });
        // rbsdm-style extras exist for the nfl only
        expect(prepareTeamCategory(fakeAstro('/year/2025/teams/tendencies', { year: '2025', category: 'tendencies' }), 'cfb')).toEqual({ notFound: true });
        const a = fakeAstro(`/nfl/year/${CURRENT_YEAR}/teams/offensive`, { year: `${CURRENT_YEAR}`, category: 'offensive' });
        expect(prepareTeamCategory(a, 'nfl')).toEqual({ redirect: `/nfl/year/${LAST_YEAR}/teams/offensive` });
        expect(a.locals.league).toBe('nfl');
        expect(prepareTeamCategory(fakeAstro('/nfl/year/2025/teams/tendencies?sort=proe', { year: '2025', category: 'tendencies' }), 'nfl'))
            .toEqual({ season: 2025, category: 'tendencies', metric: 'proe' });
    });

    test('player category and the index pages', async () => {
        const { preparePlayerCategory, prepareLeaderboard } = await import('../src/routes/leaderboards');
        const { CURRENT_YEAR, LAST_YEAR } = await import('../src/utils/constants');
        expect(preparePlayerCategory(fakeAstro('/year/2025/players/kicking', { year: '2025', category: 'kicking' }), 'cfb')).toEqual({ notFound: true });
        expect(preparePlayerCategory(fakeAstro('/year/2025/players/passing', { year: '2025', category: 'passing' }), 'cfb'))
            .toEqual({ season: 2025, category: 'passing', metric: 'TEPA' });
        expect(prepareLeaderboard(fakeAstro(`/nfl/year/${CURRENT_YEAR}/players`, { year: `${CURRENT_YEAR}` }), 'nfl', 'players'))
            .toEqual({ redirect: `/nfl/year/${LAST_YEAR}/players` });
        expect(prepareLeaderboard(fakeAstro('/year/2024/teams', { year: '2024' }), 'cfb', 'teams')).toEqual({ season: 2024 });
        // a malformed year never reaches the season tables as NaN
        expect(prepareLeaderboard(fakeAstro('/year/2025junk/teams', { year: '2025junk' }), 'cfb', 'teams')).toEqual({ notFound: true });
        expect(preparePlayerCategory(fakeAstro('/nfl/year/abc/players/passing', { year: 'abc', category: 'passing' }), 'nfl')).toEqual({ notFound: true });
    });
});

describe('nfl page file renders the shared component as NFL', () => {
    let container: AstroContainer;
    beforeAll(async () => {
        container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    });

    test('/nfl/year/2025/teams/differential', async () => {
        const { default: Page } = await import('../src/pages/nfl/year/[year]/teams/[category].astro');
        const html = await container.renderToString(Page, {
            params: { year: '2025', category: 'differential' },
            request: new Request('https://gameonpaper.com/nfl/year/2025/teams/differential'),
            locals: {},
        });
        expect(html).toContain('2025 NFL Team Rankings by Net EPA per Play');
        expect(html).toContain('href="/nfl/year/2025/team/14"');
        expect(html).toContain('teamlogos/nfl/500/14.png');
        expect(html).not.toMatch(/href="\/year\/2025\/team\//);
    }, 60_000);

    test('/year/2025/teams/differential stays college', async () => {
        const { default: Page } = await import('../src/pages/year/[year]/teams/[category].astro');
        const html = await container.renderToString(Page, {
            params: { year: '2025', category: 'differential' },
            request: new Request('https://gameonpaper.com/year/2025/teams/differential'),
            locals: {},
        });
        expect(html).toContain('href="/year/2025/team/14"');
        expect(html).toContain('teamlogos/ncaa/500/14.png');
        expect(html).not.toContain('href="/nfl/');
    }, 60_000);
});
