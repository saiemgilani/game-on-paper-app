import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { categoryColumns, formatPlayerMetric, percentileOf } from '../src/utils/players';
import { generateColorRampValue } from '../src/utils/misc';

// The compare page rendered over the player pages' captured Data API bodies (see
// fixtures/README.md). A second CFB passer is McCord's rows under another id and name,
// so two cards render from real producer rows.
const cfb = JSON.parse(readFileSync(new URL('./fixtures/player-cfb-4433971-2024.json', import.meta.url)).toString());
const nfl = JSON.parse(readFileSync(new URL('./fixtures/player-nfl-16800-2024.json', import.meta.url)).toString());
const other = { ...cfb.identity, espn_id: '5000001', player_id: '5000001', name: 'Second Passer', seasons: [2024] };
const otherRows = cfb.seasons.data.filter((r: any) => r.season === 2024 && r.category === 'passing')
    // EPA/DB has no percentile at all; Pass SR% is 95th among QBs but 5th overall, so the
    // shade says which one the cell read
    .map((r: any) => ({ ...r, player_id: '5000001', EPAplay_pct: null, EPAplay_pos_pct: null, success_pos_pct: 95, success_pct: 5 }));

// every nullable identity field null but the team name, and no season rows
const bare = { ...cfb.identity, espn_id: '5000002', player_id: '5000002', name: 'Bare Player', position: null, jersey: null, team_id: null, team: 'Syracuse', headshot_url: null, seasons: [] };

const feed = { throws: new Set<string>() };
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayer: async (id: string, league = 'cfb') => {
        if (feed.throws.has(id)) throw new Error('Data API 503');
        if (league === 'nfl') return id === '16800' ? nfl.identity : null;
        return id === '4433971' ? cfb.identity : id === '5000001' ? other : id === '5000002' ? bare : null;
    },
    retrievePlayerSeasons: async (id: string, league = 'cfb') =>
        (league === 'nfl' ? nfl.seasons.data : id === '5000001' ? otherRows : id === '5000002' ? [] : cfb.seasons.data),
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function render(league: 'cfb' | 'nfl', query: string, locals: Record<string, unknown> = { preview: true }) {
    const { default: Page } = await import(league === 'nfl' ? '../src/pages/nfl/players/compare.astro' : '../src/pages/players/compare.astro');
    const path = league === 'nfl' ? '/nfl/players/compare' : '/players/compare';
    return container.renderToResponse(Page, { request: new Request(`https://gameonpaper.com${path}${query}`), locals });
}
const html = async (league: 'cfb' | 'nfl', query: string) => (await render(league, query)).text();
/** The route step alone, for the branches that rewrite to /404 (the container has no /404 page). */
async function prep(path: string, locals: Record<string, unknown> = { preview: true }) {
    const { prepareCompare } = await import('../src/routes/compare');
    const astro: any = { locals, url: new URL(`https://gameonpaper.com${path}`), response: { headers: new Headers() }, cache: { set: () => {} } };
    return prepareCompare(astro, 'cfb');
}
/** One card's HTML. */
const card = (page: string, id: string) => page.split(`data-compare-card="${id}"`)[1]?.split('data-compare-card=')[0] ?? '';
/** A card's metric cells for a category, each [class, text]. */
const metricCells = (c: string, cat: string) => [...(c.split(`data-compare-category="${cat}"`)[1] ?? '').split('</table>')[0]
    .matchAll(/<td class="([^"]*numeral[^"]*)"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => [m[1], m[2].replace(/<[^>]*>/g, '').trim()]);

describe('the player-compare flag', () => {
    test('off, the page is the site\'s 404 and the player page has no Compare button', async () => {
        expect(await prep('/players/compare?ids=4433971,5000001', {})).toEqual({ notFound: true });
        const { default: Player } = await import('../src/pages/players/[id].astro');
        const page = await container.renderToString(Player, { params: { id: '4433971' }, request: new Request('https://gameonpaper.com/players/4433971?season=2024'), locals: {} });
        expect(page).toContain('Kyle McCord');
        expect(page).not.toContain('player-compare-link');
        expect(page).not.toContain('nav-player-compare');
    });
    test('on, the player page links to a comparison seeded with him', async () => {
        const { default: Player } = await import('../src/pages/players/[id].astro');
        const page = await container.renderToString(Player, { params: { id: '4433971' }, request: new Request('https://gameonpaper.com/players/4433971?season=2024'), locals: { preview: true } });
        expect(page).toMatch(/id="player-compare-link"\s+href="\/players\/compare\?ids=4433971&amp;season=2024"/);
        // and the header's Tools menu lists the page
        expect(page).toMatch(/href="\/players\/compare" class="dropdown-item" id="nav-player-compare"/);
    });
});

describe('CFB compare page', () => {
    test('two passers side by side, one card each, same rows in the same order', async () => {
        const page = await html('cfb', '?ids=4433971,5000001&season=2024');
        expect(page.match(/data-compare-card="/g)).toHaveLength(2);
        const a = card(page, '4433971');
        const b = card(page, '5000001');
        expect(a).toContain('Kyle McCord');
        expect(a).toContain('img-circle-bg');
        expect(a).toContain('team-logo-183');
        expect(b).toContain('Second Passer');
        // McCord ran too, so both cards list rushing; the second has dashes there
        expect(metricCells(a, 'rushing').length).toBe(categoryColumns('rushing').length);
        expect(metricCells(b, 'rushing').every(([, t]) => t === '—')).toBe(true);
        // each metric cell is the season table's: the leaderboard format, shaded by his position percentile
        const line = cfb.seasons.data.find((r: any) => r.season === 2024 && r.category === 'passing');
        const cells = metricCells(a, 'passing');
        categoryColumns('passing').forEach(([k], i) => {
            const shade = generateColorRampValue(percentileOf(line, k, true), 100);
            expect(cells[i][1].startsWith(formatPlayerMetric('passing', k, line[k])), k).toBe(true);
            if (shade) expect(cells[i][0], k).toContain(shade);
        });
        // a null percentile is an unshaded cell
        const epa = categoryColumns('passing').findIndex(([k]) => k === 'EPAplay');
        expect(metricCells(b, 'passing')[epa][0]).not.toMatch(/hulk-bg-level/);
        // the shade is his position percentile, not the overall one
        const sr = categoryColumns('passing').findIndex(([k]) => k === 'success');
        expect(metricCells(b, 'passing')[sr][0]).toContain(generateColorRampValue(95, 100)!);
        expect(metricCells(b, 'passing')[sr][0]).not.toContain(generateColorRampValue(5, 100)!);
        // a phone gets the team abbreviation, md and up the name
        expect(a).toMatch(/<span class="d-md-none"[^>]*>QB \/ #6 \/ SYR<\/span>/);
        expect(a).toMatch(/<span class="d-none d-md-inline"[^>]*>QB \/ #6 \/ Syracuse<\/span>/);
    });
    test('no position, jersey or team id: no stray separators, and a phone falls back to the team name', async () => {
        const c = card(await html('cfb', '?ids=5000002'), '5000002');
        expect(c).toMatch(/<span class="d-md-none"[^>]*>Syracuse<\/span>/);
        expect(c).toMatch(/<span class="d-none d-md-inline"[^>]*>Syracuse<\/span>/);
        // the old markup put the separator outside the spans, before them
        expect(c).not.toMatch(/>\s*\/\s*<span class="d-md-none"/);
    });
    test('a season the player never played links his name to his career page', async () => {
        const page = await html('cfb', '?ids=4433971,5000001&season=2023');
        expect(card(page, '4433971')).toContain('href="/players/4433971?season=2023"');
        expect(card(page, '5000001')).toContain('href="/players/5000001"');
    });
    test('an id the API has no player for is dropped, and the page is not cached', async () => {
        const res = await render('cfb', '?ids=4433971,9999');
        expect((await res.text()).match(/data-compare-card="/g)).toHaveLength(1);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
    test('remove links drop one id; the add box carries the rest and the season', async () => {
        const page = await html('cfb', '?ids=4433971,5000001&season=2024');
        expect(card(page, '4433971')).toContain('href="/players/compare?ids=5000001&amp;season=2024"');
        expect(page).toContain('data-template="/players/compare?ids=4433971,5000001,__ID__&amp;season=2024"');
        expect(page).toContain('id="player-compare-season"');
    });
    test('bad ids are dropped, an unknown player is left out, at most four cards', async () => {
        const page = await html('cfb', '?ids=4433971,abc,9999,4433971');
        expect(page.match(/data-compare-card="/g)).toHaveLength(1);
        expect(page).not.toContain('data-compare-card="9999"');
    });
    test('repeated ?ids= params are one list', async () => {
        const page = await html('cfb', '?ids=4433971&ids=5000001&season=2024');
        expect(page.match(/data-compare-card="/g)).toHaveLength(2);
    });
    test('no ids is the empty page with the add box', async () => {
        const page = await html('cfb', '');
        expect(page).toContain('id="player-compare-empty"');
        expect(page).toContain('id="player-compare-add"');
    });
    test('a failed read is one unavailable card, and the page is not cached', async () => {
        feed.throws.add('5000001');
        try {
            const res = await render('cfb', '?ids=4433971,5000001');
            const page = await res.text();
            expect(card(page, '5000001')).toContain('unavailable right now');
            expect(card(page, '4433971')).toContain('Kyle McCord');
            expect(res.headers.get('Cache-Control')).toBe('no-store');
        } finally {
            feed.throws.clear();
        }
    });
    test('a malformed season is a 404', async () => {
        expect(await prep('/players/compare?ids=4433971&season=24')).toEqual({ notFound: true });
        // zero-padded: would parse to 0 or 202 and every link would drop or mangle it
        expect(await prep('/players/compare?ids=4433971&season=0000')).toEqual({ notFound: true });
        expect(await prep('/players/compare?ids=4433971&season=0202')).toEqual({ notFound: true });
    });
});

describe('NFL compare page', () => {
    test('a traded receiver\'s card is his busiest team that season', async () => {
        const page = await html('nfl', '?ids=16800&season=2024');
        const a = card(page, '16800');
        expect(a).toContain('Davante Adams');
        expect(a).toContain('team-logo-20');
        expect(a).toContain('href="/nfl/players/16800?season=2024"');
        expect(metricCells(a, 'receiving').length).toBe(categoryColumns('receiving').length);
    });
});
