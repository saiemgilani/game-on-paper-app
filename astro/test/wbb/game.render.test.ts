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
import Page from '../../src/pages/wbb/game/[id].astro';
import { fromDataApi, fromProcessor } from '../../src/resources/nbaGame';
import { NCAA_W_COURTS } from '../../src/nba/data/court';

/** Plan #8's owner-ruling D33 sentence for an ingested final whose line the warehouse does not carry (Step 0 copies it verbatim). */
const D33_COPY = 'No line in the warehouse'; // plan #8's noLineText (D33), from linesFromSeason 2026 for WBB (D39)

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/${name}.json`, import.meta.url)).toString());
const plain = (h: string) => h.replace(/<[^>]+>/g, '');
const ISLAND = /<astro-island(?:\s+[\w-]+(?:="[^"]*")?)*\s*>/g;
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(ISLAND, '');
// the play groups' own <summary> labels and the shot chart's own buttons (the Header's league switch buttons left out)
const summaries = (h: string) => [...h.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => plain(m[1]).trim());
const buttons = (h: string) => [...h.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => plain(m[1]).trim()).filter((t) => t && t !== 'WBB' && t !== 'MBB');
const linescore = (h: string) => h.match(/aria-label="Linescore">[\s\S]*?<\/table>/)?.[0] ?? '';
const linescoreHeads = (h: string) => [...(linescore(h).match(/[\s\S]*?<\/thead>/)?.[0] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => plain(m[1]));
/** Each linescore body row as [team, ...period cells, total]. */
const linescoreRows = (h: string) => [...(linescore(h).match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? '').matchAll(/<tr[\s\S]*?<\/tr>/g)]
    .map((m) => [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => plain(c[1]).trim()));
/** The two cells (away, home) of one four-factors row, by its label. */
const factor = (h: string, label: string) => {
    const table = h.match(/aria-label="Four factors">[\s\S]*?<\/table>/)?.[0] ?? '';
    const row = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((r) => plain(r).trim().startsWith(label)) ?? '';
    return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
};
/** The two cells (away, home) of one team-box row, by its label. */
const teamBoxRow = (h: string, label: string) => {
    const table = h.match(/aria-label="Team box score">[\s\S]*?<\/table>/)?.[0] ?? '';
    const row = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((r) => plain(r).trim().startsWith(label)) ?? '';
    return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
};
/** A player's box cells after the name, by her name. */
const playerCells = (h: string, name: string) => {
    const row = [...h.matchAll(/<tr[^>]*>\s*<th scope="row"[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((r) => r.includes(`>${name}<`)) ?? '';
    return [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
};
/** Astro's serialized island props ([type, value] pairs; 0 value/object, 1 array), decoded, for each island whose component matches. */
const unser = ([t, v]: [number, any]): any => (t === 1 ? v.map(unser) : t === 0 && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unser(x as any)])) : v);
const islandProps = (h: string, component: string) => [...h.matchAll(/<astro-island[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes(component))
    .map((t) => unser([0, JSON.parse((t.match(/ props="([^"]*)"/)?.[1] ?? '{}').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))]));
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = (id: string) => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/wbb/game/${id}`), params: { id }, locals: { preview: true, league: 'wbb' } as App.Locals });

function common(html: string) {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('href="/wbb"');
    expect([...html.matchAll(/href="\/nba[^"]*"/g)].map((m) => m[0])).toEqual(['href="/nba"']); // the Header's league switch only
    expect(html).not.toContain('/wbb/team/'); // no WBB team pages in plan #10 (R-W9): team names are plain text
    expect(html).not.toContain('/mbb/game/');
    expect(html).toContain('aspect-ratio: 2 / 1'); // the WP island's client:only fallback box (#319 R1 I1)
    expect(plain(html)).toContain(BASKETBALL.wbb.wpModelNote); // D21, D37
    expect(html).toContain('/i/teamlogos/ncaa/');
    expect(html).toContain('id="box-home"');
    expect(html).not.toContain('>+/-<'); // college box scores have no plus-minus (R-W8)
    for (const bad of ['NaN', 'null', 'undefined']) expect(noScripts(html)).not.toContain(bad);
}
const quarters = (html: string) => {
    for (const q of ['1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter']) expect(plain(html)).toContain(q);
    expect(plain(html)).not.toMatch(/(1st|2nd) Half/);
    expect(html).not.toMatch(/>H[12]</);
};
const halves = (html: string) => {
    for (const q of ['1st Half', '2nd Half']) expect(plain(html)).toContain(q);
    expect(plain(html)).not.toMatch(/(1st|2nd|3rd|4th) Quarter/);
    expect(html).not.toMatch(/>Q[1-4]</);
};

describe('/wbb/game/[id] render (real captures)', () => {
    test('401805076 from the processor: four quarters and an overtime, labelled as quarters (D14, Review Focus 1)', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401805076_processor'), 'wbb') });
        const html = await render('401805076');
        common(html); quarters(html);
        expect(plain(html)).toContain('UTEP 87 @ Louisiana Tech 91');
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', '3', '4', 'OT', 'T']);
        expect(summaries(html)).toEqual(['1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter', 'Overtime']);
        expect(buttons(html)).toEqual(['All', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'All', 'Q1', 'Q2', 'Q3', 'Q4', 'OT']);
        expect(html).toContain('overtime included');
        expect(html).toContain('href="/wbb/scoreboard?date=2026-03-07&amp;group=all"'); // a 7 pm ET tip on March 7
        expect(plain(html)).toContain('No line, pregame prior LT');
    });
    test('400550784 from the Data API: a 2014 game is two halves, no shot locations, no linescore in the release (D14, Decision 7, R-W15)', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_400550784_api'), 'wbb') });
        const html = await render('400550784');
        common(html); halves(html);
        expect(plain(html)).toContain('Rutgers 56 @ UTEP 54');
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', 'T']);
        // the release carries no linescores before 2024 (R-W15): the period cells are the page's dashes, only the totals are numbers
        expect(linescoreRows(html)).toEqual([['RUTG', '–', '–', '56'], ['UTEP', '–', '–', '54']]);
        expect(summaries(html)).toEqual(['1st Half', '2nd Half']);
        expect(buttons(html)).toEqual([]);
        expect(plain(html)).toContain('ESPN has no shot locations for this game.');
        expect(html).not.toContain('overtime included');
        expect(html).toContain('href="/wbb/scoreboard?date=2014-04-05&amp;group=all"');
        expect(plain(html)).not.toContain(D33_COPY);       // D39: 2014 < linesFromSeason 2026: no warehouse sentence
        expect(plain(html)).toMatch(/No line, pregame prior UTEP/);
    });
    test('273130043 from the Data API: before 2009 the turnover rates are dashes, never 0 (D12, Review Focus 2)', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_273130043_api'), 'wbb') });
        const html = await render('273130043');
        common(html); halves(html);
        expect(plain(html)).toContain('Stanford 100 @ Yale 44');
        expect(summaries(html)).toEqual(['1st Half', '2nd Half']);
        for (const label of ['TOV%', 'Possessions', 'ORtg', 'DRtg', 'Pace']) expect(factor(html, label), label).toEqual(['–', '–']);
        expect(factor(html, 'eFG%').every((c) => c !== '–' && c !== '')).toBe(true);
        expect(plain(html)).not.toMatch(/TOV%\s*0\.0/);
    });
    // R-W16: ESPN's 2008 box sends 0 for minutes and turnovers nobody recorded; the processor passes the 0s through, the Data API
    // nulls the minutes. Both pages show dashes, read from the data's signature (all minutes 0; box 0 turnovers with null rates).
    test.each([['processor', () => fromProcessor(read('game_273130043_processor'), 'wbb')], ['Data API', () => fromDataApi(read('game_273130043_api'), 'wbb')]] as const)(
        '273130043 from the %s: minutes and turnovers not recorded are dashes, never 0 (R-W16); no line before 2026 (D39)', async (_src, game) => {
            prep.mockResolvedValueOnce({ game: game() });
            const html = await render('273130043');
            common(html);
            expect(teamBoxRow(html, 'Turnovers (player + team)')).toEqual(['–', '–']);
            expect(plain(html)).not.toContain('0 (0 + 0)');
            expect(teamBoxRow(html, 'Rebounds (off-def)').every((c) => /^\d+ \(/.test(c))).toBe(true); // recorded counts stay numbers
            // a 20-point starter: MIN and TOV dashes, PTS her 20 (cells: MIN PTS REB AST STL BLK TOV ...)
            const [min, pts, , , , , tov] = playerCells(html, 'Jayne Appel-Marinelli');
            expect([min, pts, tov]).toEqual(['–', '20', '–']);
            for (const name of ['Candice Wiggins', 'Mady Gobrecht']) expect(playerCells(html, name)[0], name).toBe('–');
            expect(plain(html)).toMatch(/No line, pregame prior/);
            expect(plain(html)).not.toContain(D33_COPY); // 2008 < linesFromSeason 2026
        });
    test('401827362 from the Data API: quarters, no line after ingest with the D33 copy, one unlocated jump shot (D33, D29)', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401827362_api'), 'wbb') });
        const html = await render('401827362');
        common(html); quarters(html);
        expect(plain(html)).toContain('Kansas 77 @ TCU 79');
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', '3', '4', 'T']);
        expect(summaries(html)).toEqual(['1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter']);
        expect(buttons(html)).toEqual(['All', 'Q1', 'Q2', 'Q3', 'Q4', 'All', 'Q1', 'Q2', 'Q3', 'Q4']);
        expect(plain(html)).toContain(`${D33_COPY}, pregame prior TCU`); // 2026 >= linesFromSeason (D39)
        expect(plain(html)).toContain('1 of 56 shots have no recorded location');
        expect(factor(html, 'TOV%').every((c) => /^\d/.test(c))).toBe(true); // 2026 turnovers are real numbers
    });
    test("401827362 from the processor: ESPN's DraftKings line, in the header's home-side form (Decision 8)", async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401827362_processor'), 'wbb') });
        const html = await render('401827362');
        common(html);
        expect(plain(html)).toMatch(/Line: TCU -15\.5/);
        expect(plain(html)).not.toContain(D33_COPY);
    });
    test('401856459 from the Data API: "Neutral site, no line" (D13)', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401856459_api'), 'wbb') });
        const html = await render('401856459');
        common(html); quarters(html);
        expect(plain(html)).toContain('Neutral site, no line, pregame prior COFC 50%');
        expect(html).not.toContain('home-court');
        expect(plain(html)).toContain('CareFirst Arena');
        expect(html).toContain('href="/wbb/scoreboard?date=2026-03-15&amp;group=all"');
    });
    test('401702870 from the processor: ESPN located none of the 104 attempts', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401702870_processor'), 'wbb') });
        const html = await render('401702870');
        common(html); quarters(html);
        expect(plain(html)).toContain('ESPN has no shot locations for this game: 104 of 104 shots have no recorded location.');
        expect(buttons(html)).toEqual([]);
    });
    test("401920983, scheduled (real staged ESPN page): the pregame page asks ESPN for the women's college summary", async () => {
        const pg = read('pregame_401920983');
        prep.mockResolvedValueOnce({ pregame: true, espnGame: pg });
        summary.mockResolvedValueOnce(read('pregame_401920983_summary'));
        const html = await render('401920983');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        for (const c of pg.gamepackageJSON.header.competitions[0].competitors) expect(html).toContain(c.team.displayName);
        expect(html).toContain('href="/wbb/scoreboard?date=2026-11-01&group=all"'); // GenericPage writes breadcrumbs as raw HTML (unescaped &)
        expect(html).not.toContain('/wbb/team/');
        expect(summary.mock.calls[0][1]).toBe('wbb');
    });
    test('the processor-unavailable answer is a 503 naming the game', async () => {
        prep.mockResolvedValueOnce({ unavailable: true });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wbb/game/401805076'), params: { id: '401805076' }, locals: { preview: true, league: 'wbb' } as App.Locals });
        expect([res.status, res.headers.get('Cache-Control'), await res.text()]).toEqual([503, 'no-store', 'This game is temporarily unavailable. Please try again shortly.']);
    });
});

// Review Minor 5: what the islands are handed, from BOTH adapters (the server HTML alone would not show a wrong period shape or court)
describe('/wbb/game/[id] island props', () => {
    const sources = (id: string) => [['processor', () => fromProcessor(read(`game_${id}_processor`), 'wbb')], ['Data API', () => fromDataApi(read(`game_${id}_api`), 'wbb')]] as const;
    test.each(sources('400550784'))('400550784 (2014, halves) from the %s: the WP island gets regulationPeriods 2 and periodKind half', async (_src, game) => {
        const g = game();
        expect([g.season, g.regulation, g.periodKind]).toEqual([2014, 2, 'half']);
        prep.mockResolvedValueOnce({ game: g });
        const wp = islandProps(await render('400550784'), 'WinProbabilityChart');
        expect(wp).toHaveLength(1);
        expect([wp[0].regulationPeriods, wp[0].periodKind]).toEqual([2, 'half']);
    });
    test.each(sources('401827362'))('401827362 (2026) from the %s: season 2026 and both shot charts get the 2024+ court, no restricted arc (D32)', async (_src, game) => {
        const g = game();
        expect(g.season).toBe(2026);
        prep.mockResolvedValueOnce({ game: g });
        const charts = islandProps(await render('401827362'), 'GameShotChart');
        expect(charts).toHaveLength(2);
        const court = NCAA_W_COURTS.at(-1)!;
        expect(court.from).toBe(2024);
        for (const c of charts) {
            expect(c.court).toEqual(court.court);
            expect(c.court.restrictedRadius).toBe(0);
            expect(c.regulationPeriods).toBeUndefined(); // four quarters: the islands' NBA defaults
        }
    });
});
