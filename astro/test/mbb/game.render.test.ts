import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/game', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/game')>()), prepareBasketballGame: (...a: unknown[]) => prep(...a) }));
const summary = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGameSummary: (...a: unknown[]) => summary(...a) }));
import Page from '../../src/pages/mbb/game/[id].astro';
import { fromDataApi, fromProcessor } from '../../src/resources/nbaGame';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/${name}.json`, import.meta.url)).toString());
const plain = (h: string) => h.replace(/<[^>]+>/g, '');
const ISLAND = /<astro-island(?:\s+[\w-]+(?:="[^"]*")?)*\s*>/g;
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(ISLAND, '');
// the play groups' own <summary> labels and the shot chart's own buttons (the Header's league switch buttons left out)
const summaries = (h: string) => [...h.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => plain(m[1]).trim());
const buttons = (h: string) => [...h.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => plain(m[1]).trim()).filter((t) => t && t !== 'MBB');
const linescoreHeads = (h: string) => [...(h.match(/aria-label="Linescore">[\s\S]*?<\/thead>/)?.[0] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => plain(m[1]));
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = (id: string) => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/mbb/game/${id}`), params: { id }, locals: { preview: true, league: 'mbb' } as App.Locals });

function common(html: string) {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('href="/mbb"');
    expect([...html.matchAll(/href="\/nba[^"]*"/g)].map((m) => m[0])).toEqual(['href="/nba"']); // the Header's league switch only
    expect(html).not.toContain('/mbb/team/'); // no MBB team pages yet (plan #9)
    expect(html).toContain('aspect-ratio: 2 / 1'); // the WP island's client:only fallback box (#319 R1 I1)
    expect(plain(html)).toContain(BASKETBALL.mbb.wpModelNote); // D21
    expect(html).toContain('/i/teamlogos/ncaa/');
    expect(html).toContain('id="box-home"');
    expect(html).not.toContain('>+/-<'); // college box scores have no plus-minus: no always-dash column (the NBA snapshot keeps it)
    for (const bad of ['NaN', 'null', 'undefined']) expect(noScripts(html)).not.toContain(bad);
    expect(plain(html)).not.toMatch(/(1st|2nd|3rd|4th) Quarter/);
    expect(html).not.toMatch(/>Q[1-4]</);
}

describe('/mbb/game/[id] render (real captures)', () => {
    test('401820775 from the processor: two halves and an overtime, labelled as halves everywhere (D14, Review Focus 1)', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401820775_processor'), 'mbb') });
        const html = await render('401820775');
        common(html);
        expect(plain(html)).toContain('NC State 90 @ Notre Dame 96');
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', 'OT', 'T']);
        expect(summaries(html)).toEqual(['1st Half', '2nd Half', 'Overtime']);
        expect(buttons(html)).toEqual(['All', 'H1', 'H2', 'OT', 'All', 'H1', 'H2', 'OT']);
        expect(html).toContain('overtime included');
        expect(html).toContain('href="/mbb/scoreboard?date=2026-02-28&amp;group=all"'); // Decision 10
        // ESPN's line on the processor path (Decision 8), in the header's home-side form: home = ND, so the -6.5 home spread reads ND +6.5
        expect(plain(html)).toContain('Line: ND +6.5, pregame prior ND 28% (from the spread)');
    });
    test('401808271 from the Data API: regulation, the line is not in the warehouse (Decision 8, D33), the (25, 0) layup drawn', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401808271_api'), 'mbb') });
        const html = await render('401808271');
        common(html);
        expect(plain(html)).toContain('Alabama 71 @ Tennessee 69');
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', 'T']);
        expect(summaries(html)).toEqual(['1st Half', '2nd Half']);
        expect(buttons(html)).toEqual(['All', 'H1', 'H2', 'All', 'H1', 'H2']);
        expect(plain(html)).toContain('No line in the warehouse, pregame prior TENN'); // D33: 2026 >= linesFromSeason 2013 (D39)
        expect(plain(html)).toContain('(home-court advantage only)');
        expect(html).not.toContain('overtime included');
        expect(plain(html)).not.toContain('no recorded location');
    });
    test('401744223 from the Data API: "Neutral site, no line", one unlocated jump shot per side (D13, D29)', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401744223_api'), 'mbb') });
        const html = await render('401744223');
        common(html);
        expect(plain(html)).toContain('Neutral site, no line, pregame prior TXST 50%');
        expect(html).not.toContain('home-court');
        expect(plain(html)).toContain('Pensacola Bay Center');
        expect(plain(html)).toContain('1 of 60 shots have no recorded location');
        expect(plain(html)).toContain('1 of 62 shots have no recorded location');
        expect(html).toContain('href="/mbb/scoreboard?date=2025-03-06&amp;group=all"'); // a 8:30 pm ET tip on March 6
    });
    test('401829457 from the processor: the neutral-site score (Decision 7)', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401829457_processor'), 'mbb') });
        const html = await render('401829457');
        common(html);
        expect(plain(html)).toMatch(/Coastal Carolina 75 \S+ North Dakota 58/);
        expect(plain(html)).toContain('Neutral site, no line, pregame prior UND 50%');
    });
    test('401706366 from the processor: ESPN located none of the 136 attempts', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401706366_processor'), 'mbb') });
        const html = await render('401706366');
        common(html);
        expect(plain(html)).toContain('ESPN has no shot locations for this game: 136 of 136 shots have no recorded location.');
        expect(html).not.toContain('Western Michigan Broncos shots'); // GameShotChart's title, `${displayName} shots`
    });
    test('401920982, scheduled (real ESPN page): the pregame page asks ESPN for the men\'s college summary', async () => {
        const pg = read('pregame_401920982');
        prep.mockResolvedValueOnce({ pregame: true, espnGame: pg });
        summary.mockResolvedValueOnce(read('pregame_401920982_summary'));
        const html = await render('401920982');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        for (const c of pg.gamepackageJSON.header.competitions[0].competitors) expect(html).toContain(c.team.displayName);
        expect(html).toContain('href="/mbb/scoreboard?date=2026-11-01&group=all"'); // GenericPage writes breadcrumbs as raw HTML (unescaped &)
        expect(html).not.toContain('/mbb/team/');
        expect(summary.mock.calls[0][1]).toBe('mbb');
    });
    test('the processor-unavailable answer is a 503 naming the game', async () => {
        prep.mockResolvedValueOnce({ unavailable: true });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/mbb/game/401820775'), params: { id: '401820775' }, locals: { preview: true, league: 'mbb' } as App.Locals });
        expect([res.status, res.headers.get('Cache-Control'), await res.text()]).toEqual([503, 'no-store', 'This game is temporarily unavailable. Please try again shortly.']);
    });
});
