import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/game', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/game')>()), prepareBasketballGame: (...a: unknown[]) => prep(...a) }));
const summary = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGameSummary: (...a: unknown[]) => summary(...a) }));
import Page from '../../src/pages/wnba/game/[id].astro';
import { fromDataApi, fromProcessor } from '../../src/resources/nbaGame';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wnba/${name}.json`, import.meta.url)).toString());
const plain = (h: string) => h.replace(/<[^>]+>/g, '');
const ISLAND = /<astro-island(?:\s+[\w-]+(?:="[^"]*")?)*\s*>/g;
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(ISLAND, '');
// every header cell, inner tags stripped: the first is the visually-hidden "Team"
const summaries = (h: string) => [...h.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => plain(m[1]).trim());
const buttons = (h: string) => [...h.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => plain(m[1]).trim()).filter((t) => t && t !== 'WNBA');
const linescoreHeads = (h: string) => [...(h.match(/aria-label="Linescore">[\s\S]*?<\/thead>/)?.[0] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => plain(m[1]));
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = (id: string) => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/wnba/game/${id}`), params: { id }, locals: { preview: true, league: 'wnba' } as App.Locals });

function common(html: string) {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('href="/wnba"'); // the league crumb
    expect([...html.matchAll(/href="\/nba[^"]*"/g)].map((m) => m[0])).toEqual(['href="/nba"']); // only the Header's league switch
    expect(html).toMatch(/href="\/wnba\/team\/16116613\d\d(\?season=\d{4})?"/); // team names link the team pages (plan #6), a past season's with its ?season=
    expect(html).toContain('aspect-ratio: 2 / 1'); // the WP island's client:only fallback box (#319 R1 I1)
    // D21/D37 (R13): the WP panel names the WNBA model by what sdv-py records, verbatim and unescaped; never the NBA sentence
    expect(plain(html)).toContain("Game on Paper's WNBA in-game model (sdv-py wnba_in_game_wp.ubj): score margin, time remaining, the pregame prior and possession. The pregame home edge was fitted on 220 of 264 2024 WNBA games.");
    expect(plain(html)).not.toContain("Game on Paper's in-game model:");
    for (const bad of ['NaN', 'null', 'undefined']) expect(noScripts(html)).not.toContain(bad);
}

describe('/wnba/game/[id] render (real captures)', () => {
    test('250603003, 2005: two halves and an overtime, labelled as halves everywhere (D14, Review Focus 1)', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_250603003_processor'), 'wnba') });
        const html = await render('250603003');
        common(html);
        // the WP island gets the season, which keys a WNBA logo (wnbaLogoId: the 2000-02 Portland Fire under 132052)
        expect(html).toContain('&quot;season&quot;:[0,2005]');
        expect(plain(html)).toContain('New York 66 @ Detroit 68');
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', 'OT', 'T']);
        // the play groups' own <summary> labels and the shot chart's own buttons, not any text that mentions a half
        expect(summaries(html)).toEqual(['1st Half', '2nd Half', 'Overtime']);
        expect(plain(html)).not.toMatch(/(1st|2nd|3rd|4th) Quarter/);
        expect(buttons(html)).toEqual(['All', 'H1', 'H2', 'OT', 'All', 'H1', 'H2', 'OT']);
        expect(html).toContain('href="/wnba/scoreboard?date=2005-06-03"');
        expect(html).toContain('overtime included');
        expect(html.match(/home-court advantage/g)).toHaveLength(1);
        // ESPN spells id 3 "TUL" in 2005 beside "Detroit Shock"; the era tricode (WNBA_FORMER_NAMES) is DET everywhere
        expect(html).not.toContain('TUL');
        expect(html).toContain('aria-current="page">NYL @ DET</li>'); // breadcrumb
        expect(html).toMatch(/<th scope="row" class="text-start fw-normal">DET<\/th>/); // linescore row
        expect(plain(html)).toContain('pregame prior DET 54%');
        expect(html).toContain('aria-label="DET player box score"');
        expect(html).toContain('Score (NYL-DET)'); // plays tables
        expect(html).toContain('DET WP');
        expect(html).toContain('<h3 class="h6">DET</h3>'); // shot-chart heading
    });
    test("250603003, 2005: the team links carry the game's season (Detroit is Dallas's franchise page for 2005)", async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_250603003_processor'), 'wnba') });
        const html = await render('250603003');
        const teamHrefs = [...html.matchAll(/href="(\/wnba\/team\/[^"]*)"/g)].map((m) => m[1]);
        expect(teamHrefs).toEqual(['/wnba/team/1611661313?season=2005', '/wnba/team/1611661321?season=2005']);
    });
    test('401736289 from the Data API: double overtime after four quarters', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401736289_api'), 'wnba') });
        const html = await render('401736289');
        common(html);
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', '3', '4', 'OT', '2OT', 'T']);
        expect(summaries(html)).toEqual(['1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter', 'Overtime', '2nd Overtime']);
        expect(html).toContain('href="/wnba/scoreboard?date=2025-08-01"'); // a 10 pm ET tip on Aug 1
    });
    test('401736325 from the Data API: "Neutral site, no line", never home-court (D13, Review Focus 3)', async () => {
        prep.mockResolvedValueOnce({ game: fromDataApi(read('game_401736325_api'), 'wnba') });
        const html = await render('401736325');
        common(html);
        expect(plain(html)).toContain('Neutral site, no line, pregame prior ATL 50%');
        expect(html).not.toContain('home-court');
        expect(plain(html).match(/no line/gi)).toHaveLength(1);
        expect(plain(html)).toContain('Rogers Arena');
    });
    test('401736287 from the processor: Golden State, the 2025 expansion team, unlinked', async () => {
        prep.mockResolvedValueOnce({ game: fromProcessor(read('game_401736287_processor'), 'wnba') });
        const html = await render('401736287');
        common(html);
        expect(plain(html)).toContain('Golden State 73 @ Chicago 66');
        expect(linescoreHeads(html).slice(1)).toEqual(['1', '2', '3', '4', 'T']);
    });
    test('401918306, scheduled (real ESPN page): the pregame page asks ESPN for the WNBA summary', async () => {
        prep.mockResolvedValueOnce({ pregame: true, espnGame: read('pregame_401918306') });
        summary.mockResolvedValueOnce(read('pregame_401918306_summary'));
        const html = await render('401918306');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        expect(html).toContain('Atlanta Dream at Golden State Valkyries');
        expect(html).toContain('href="/wnba/scoreboard?date=2026-10-19"'); // a 00:00Z tip is 8 pm ET on Oct 19
        for (const id of [1611661330, 1611661331]) expect(html).toContain(`href="/wnba/team/${id}"`);
        expect(summary.mock.calls[0][1]).toBe('wnba');
    });
    test('the processor-unavailable answer is a 503 naming the game', async () => {
        prep.mockResolvedValueOnce({ unavailable: true });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wnba/game/401736287'), params: { id: '401736287' }, locals: { preview: true, league: 'wnba' } as App.Locals });
        expect([res.status, res.headers.get('Cache-Control'), await res.text()]).toEqual([503, 'no-store', 'This game is temporarily unavailable. Please try again shortly.']);
    });
});
