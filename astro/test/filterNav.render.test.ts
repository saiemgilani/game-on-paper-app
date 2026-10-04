import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// 'filter-nav': a previous/next week stepper under the schedule pickers. The
// public page must not change at all, so the flag-off renders are pinned by hash.
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-summaries-2025.json', import.meta.url)).toString());
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSummaries: async () => fx.team_summaries,
    retrievePlayerSummaries: async () => fx.passing,
    retrievePercentiles: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function schedule(props: Record<string, unknown>, locals: Partial<App.Locals>, path = '/year/2025/type/2/week/5') {
    const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
    return container.renderToString(SchedulePage, {
        props: { games: [], isScoreboard: false, ...props },
        request: new Request(`https://gameonpaper.com${path}`),
        locals: locals as App.Locals,
    });
}

async function leaderboard(kind: 'teams' | 'players', locals: Partial<App.Locals>) {
    const { default: Page } = kind === 'teams'
        ? await import('../src/components/leaderboards/TeamLeaderboardPage.astro')
        : await import('../src/components/leaderboards/PlayerLeaderboardPage.astro');
    const props = kind === 'teams'
        ? { season: 2025, category: 'differential', metric: 'net_adj_epa' }
        : { season: 2025, category: 'passing', metric: 'EPAplay' };
    return container.renderToString(Page, {
        props,
        request: new Request(`https://gameonpaper.com/nfl/year/2025/${kind}/${props.category}`),
        locals: { league: 'nfl', ...locals } as App.Locals,
    });
}

describe('week stepper (filter-nav)', () => {
    test('preview: previous and next weeks as named links, group kept', async () => {
        const html = await schedule({ season: 2025, seasontype: 2, week: 5, group: 80 }, { preview: true });
        expect(html).toContain('aria-label="Week"');
        expect(html).toMatch(/href="\/year\/2025\/type\/2\/week\/4\?group=80"[^>]*rel="prev"[^>]*aria-label="Previous week: Week 4"/);
        expect(html).toMatch(/href="\/year\/2025\/type\/2\/week\/6\?group=80"[^>]*rel="next"[^>]*aria-label="Next week: Week 6"/);
    }, 60_000);
    test('cfb: week 16 steps into Bowls, Bowls into CFP; CFP has no next', async () => {
        expect(await schedule({ season: 2025, seasontype: 2, week: 16, group: 80 }, { preview: true }))
            .toMatch(/href="\/year\/2025\/type\/3\/week\/1\?group=80"[^>]*rel="next"[^>]*aria-label="Next week: Bowls"/);
        const bowls = await schedule({ season: 2025, seasontype: 3, week: 1, group: 80 }, { preview: true });
        expect(bowls).toMatch(/href="\/year\/2025\/type\/2\/week\/16\?group=80"[^>]*rel="prev"/);
        expect(bowls).toMatch(/href="\/year\/2025\/type\/3\/week\/999\?group=80"[^>]*rel="next"/);
        const cfp = await schedule({ season: 2025, seasontype: 3, week: 999, group: 80 }, { preview: true });
        expect(cfp).toContain('rel="prev"');
        expect(cfp).not.toContain('rel="next"');
    }, 60_000);
    test('cfb: week 1 has no previous', async () => {
        const html = await schedule({ season: 2025, seasontype: 2, week: 1, group: 80 }, { preview: true });
        expect(html).toContain('rel="next"');
        expect(html).not.toContain('rel="prev"');
    }, 60_000);
    test('nfl: links carry the /nfl prefix and no group; Wild Card steps back to week 18', async () => {
        const html = await schedule({ season: 2025, seasontype: 3, week: 1 }, { preview: true, league: 'nfl' }, '/nfl/year/2025/type/3/week/1');
        expect(html).toMatch(/href="\/nfl\/year\/2025\/type\/2\/week\/18"[^>]*rel="prev"/);
        expect(html).toMatch(/href="\/nfl\/year\/2025\/type\/3\/week\/2"[^>]*rel="next"/);
    }, 60_000);
    test('nfl: week 1 has no previous, the Super Bowl no next', async () => {
        const first = await schedule({ season: 2025, seasontype: 2, week: 1 }, { preview: true, league: 'nfl' }, '/nfl/year/2025/type/2/week/1');
        expect(first).not.toContain('rel="prev"');
        expect(first).toContain('href="/nfl/year/2025/type/2/week/2"');
        const last = await schedule({ season: 2025, seasontype: 3, week: 5 }, { preview: true, league: 'nfl' }, '/nfl/year/2025/type/3/week/5');
        expect(last).toContain('href="/nfl/year/2025/type/3/week/4"');
        expect(last).not.toContain('rel="next"');
    }, 60_000);
    test('the public page has no stepper', async () => {
        const html = await schedule({ season: 2025, seasontype: 2, week: 5, group: 80 }, {});
        expect(html).not.toContain('aria-label="Week"');
        expect(html).not.toContain('rel="next"');
    }, 60_000);
});

describe('phone filters (filter-nav)', () => {
    test('preview: the schedule pickers sit in a collapse that is always open from md up; the stepper stays outside it', async () => {
        const html = await schedule({ season: 2025, seasontype: 2, week: 5, group: 80 }, { preview: true });
        expect(html).toMatch(/<button[^>]*class="btn btn-sm btn-outline-secondary d-md-none mb-3"[^>]*data-bs-target="#schedule-filters"/);
        expect(html).toContain('class="collapse d-md-block" id="schedule-filters"');
        const folded = html.slice(html.indexOf('id="schedule-filters"'), html.indexOf('aria-label="Week"'));
        expect(folded).toContain('form-picker');
        expect(folded).not.toContain('rel="next"');
    }, 60_000);
    test.each(['teams', 'players'] as const)('preview: the %s leaderboard pickers get the same treatment', async (kind) => {
        const html = await leaderboard(kind, { preview: true });
        expect(html).toMatch(/<button[^>]*data-bs-target="#leaderboard-filters"/);
        expect(html).toContain('class="collapse d-md-block" id="leaderboard-filters"');
    }, 60_000);
    test('public: no toggle, pickers rendered as before', async () => {
        const s = await schedule({ season: 2025, seasontype: 2, week: 5, group: 80 }, {});
        expect(s).not.toContain('schedule-filters');
        expect(s).toContain('form-picker');
        const t = await leaderboard('teams', {});
        expect(t).not.toContain('leaderboard-filters');
        expect(t).toContain('dropdown-form');
    }, 60_000);
});

describe('filter-nav off: the pages are byte-for-byte what main renders', () => {
    // Hashes of the flag-off renders on origin/main b5665b08, before 'filter-nav'
    // existed (same test body, run there). Another PR that changes these pages
    // moves them on purpose: re-run with PRINT_GOLDEN=1 and paste. Delete this
    // block when the flag is promoted.
    const ASTRO_DIR = new URL('..', import.meta.url).pathname;
    const normalise = (html: string) => html.replace(/\suid="[^"]*"/g, ' uid=""').split(ASTRO_DIR).join('');
    const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
    const GOLDEN: Record<string, string> = {
        'cfb-week': '08053dc80840f386',
        'cfb-scoreboard': '0c5f21b522a7d423',
        'nfl-week': '119044680cbb66a5',
        'nfl-teams': '75edd86eb71d5642',
        'nfl-players': '7085632ca71302f2',
    };
    const PAGES: Record<string, () => Promise<string>> = {
        'cfb-week': () => schedule({ season: 2025, seasontype: 2, week: 5, group: 80 }, {}),
        'cfb-scoreboard': () => schedule({ season: 2026, seasontype: 2, week: 6, isScoreboard: true }, {}, '/'),
        'nfl-week': () => schedule({ season: 2025, seasontype: 2, week: 18 }, { league: 'nfl' }, '/nfl/year/2025/type/2/week/18'),
        'nfl-teams': () => leaderboard('teams', {}),
        'nfl-players': () => leaderboard('players', {}),
    };

    test.each(Object.keys(PAGES))('%s', async (page) => {
        const html = await PAGES[page]();
        if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${page} ${sha(normalise(html))}`);
        expect(sha(normalise(html))).toBe(GOLDEN[page]);
    }, 60_000);
});
