/**
 * The Deserved Win % margins table with the producer's per-margin impact
 * (python/paper_index.py `share_from_inputs` -> `impact`) shown as arrows, and
 * rows in the model's importance order (`compute` -> `importance`).
 *
 * The fixture is the real `/cfb/400869270/process` body, which predates
 * `impact`. IMPACT below is what `share_from_inputs` returns for this
 * fixture's own `paperIndex.teams` inputs (home 197, away 2117), so the
 * payload is the one today's producer would serve for the game.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadGzJson, locals, parseTable } from './helpers/tables';

const IMPACT: Record<string, number> = {
    success: -0.300563,
    explosive: -0.168824,
    explosive_epa: -1.905242,
    opp_conversion: -0.979429,
    pts_per_opp: -0.093,
    field_position: 2.420635,
    havoc: -0.052904,
    turnovers: 0.6005,
};
// python/paper_index.py IMPORTANCE["cfb"]: success, field position, explosiveness,
// opportunity conversion, turnovers, points per opportunity, havoc, explosive rate
const IMPORTANCE: Record<string, number> = {
    success: 2.8484,
    explosive: 0.1217,
    explosive_epa: 1.1618,
    opp_conversion: 1.139,
    pts_per_opp: 0.4604,
    field_position: 1.4995,
    havoc: 0.4481,
    turnovers: 1.059,
};
const LABELS: Record<string, string> = {
    success: 'Success Rate',
    explosive: 'Explosive Play Rate',
    explosive_epa: 'Explosiveness (EPA/success)',
    opp_conversion: 'Opportunity Conversion Rate',
    pts_per_opp: 'Points per opportunity',
    field_position: 'Field position (EP)',
    havoc: 'Havoc Rate',
    turnovers: 'Turnovers',
};
const game = loadGzJson('usage-cfb-400869270.json.gz');
const competitors = game.header.competitions[0].competitors;
const homeTeam = competitors.find((c: any) => c.homeAway === 'home').team;
const awayTeam = competitors.find((c: any) => c.homeAway === 'away').team;

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

const render = async (result: any) => {
    const { default: PaperIndex } = await import('../src/components/game/metrics/PaperIndex.astro');
    const html = await container.renderToString(PaperIndex, {
        props: { result, homeTeam, awayTeam, completed: true }, locals: locals('cfb'),
    });
    return { html, ...parseTable(html) };
};

const CAPTION = "Sorted by each metric's importance in the model. Arrows show how much it moved this game's Deserved Win %.";
const caption = (html: string) => html.match(/<caption[^>]*>([\s\S]*?)<\/caption>/)?.[1].replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// the impact cell of a body row: its arrow icons and its em-dash
const arrows = (row: string) => {
    const cell = row.match(/<td[\s\S]*?<\/td>/g)![2];
    return {
        up: (cell.match(/bi-arrow-up/g) ?? []).length,
        down: (cell.match(/bi-arrow-down/g) ?? []).length,
        dash: cell.includes('—'),
        style: cell.match(/<td[^>]*>/)![0],
    };
};

describe('Deserved Win %: margin impact', () => {
    test('rows in importance order; impact as one to three arrows or an em-dash, no percents', async () => {
        expect(Object.keys(IMPACT).sort()).toEqual(Object.keys(game.paperIndex.margins).sort());
        const { html, headers, rows, rowHtml } = await render({ ...game.paperIndex, impact: IMPACT, importance: IMPORTANCE });
        expect(headers).toEqual(['Margin', '', 'Impact']);
        const body = rows.slice(1);
        expect(body.map((r) => r[0])).toEqual([
            'Success Rate', 'Field position (EP)', 'Explosiveness (EPA/success)', 'Opportunity Conversion Rate',
            'Turnovers', 'Points per opportunity', 'Havoc Rate', 'Explosive Play Rate',
        ]);
        // IMPACT: success -0.30, fp +2.42, epa -1.91, conv -0.98, TO +0.60, ppo -0.09, havoc -0.05, explosive -0.17
        expect(rowHtml.slice(1).map((r) => { const a = arrows(r); return a.dash ? '—' : a.up ? `up${a.up}` : `down${a.down}`; }))
            .toEqual(['down1', 'up3', 'down3', 'down2', 'up1', '—', '—', '—']);
        expect(body.map((r) => r[2])).toEqual([
            'slightly hurt TEX', 'strongly helped TEX', 'strongly hurt TEX', 'clearly hurt TEX',
            'slightly helped TEX', '— little impact', '— little impact', '— little impact',
        ].map((t) => t.replace('TEX', homeTeam.abbreviation)));
        expect(body.every((r) => !r[2].includes('%'))).toBe(true);
        expect(arrows(rowHtml[2]).style).toContain('var(--bs-green)');
        expect(arrows(rowHtml[1]).style).toContain('var(--bs-purple)');
        expect(arrows(rowHtml[6]).style).toContain('text-muted');
        expect(caption(html)).toBe(CAPTION);
    }, 30_000);

    test('the steps: under 0.25 is an em-dash, then 0.25, 0.75 and 1.5; a missing impact is an em-dash', async () => {
        const impact: Record<string, number | null> = {
            success: 0.249, explosive: 0.25, explosive_epa: 0.75, opp_conversion: 1.5,
            pts_per_opp: -0.25, field_position: -1.499, havoc: null,
        };
        const { rows, rowHtml } = await render({ ...game.paperIndex, impact, importance: IMPORTANCE });
        const byLabel = Object.fromEntries(rows.slice(1).map((r, i) => [r[0], arrows(rowHtml[i + 1])]));
        expect(byLabel['Success Rate']).toMatchObject({ up: 0, down: 0, dash: true });
        expect(byLabel['Explosive Play Rate']).toMatchObject({ up: 1, dash: false });
        expect(byLabel['Explosiveness (EPA/success)']).toMatchObject({ up: 2 });
        expect(byLabel['Opportunity Conversion Rate']).toMatchObject({ up: 3 });
        expect(byLabel['Points per opportunity']).toMatchObject({ down: 1 });
        expect(byLabel['Field position (EP)']).toMatchObject({ down: 2 });
        expect(byLabel['Havoc Rate']).toMatchObject({ dash: true });
        expect(byLabel['Turnovers']).toMatchObject({ dash: true });
        expect(rows.find((r) => r[0] === 'Turnovers')![2]).toBe('— not measured');
    }, 30_000);

    test('without importance the rows keep display order', async () => {
        const { rows } = await render({ ...game.paperIndex, impact: IMPACT });
        expect(rows.slice(1).map((r) => r[0])).toEqual(Object.values(LABELS));
    }, 30_000);

    test('a payload without impact keeps the two-column table in display order, no caption', async () => {
        const { html, headers, rows } = await render(game.paperIndex);
        expect(headers).toEqual(['Margin', '']);
        expect(rows.slice(1).map((r) => r[0])).toEqual(Object.values(LABELS));
        expect(rows.slice(1).every((r) => r.length === 2)).toBe(true);
        expect(caption(html)).toBeUndefined();
    }, 30_000);
});
