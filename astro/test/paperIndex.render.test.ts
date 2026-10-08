/**
 * The Deserved Win % margins table with the producer's per-margin impact
 * (python/paper_index.py `share_from_inputs` -> `impact`).
 *
 * The fixture is the real `/cfb/400869270/process` body, which predates
 * `impact`. IMPACT below is what `share_from_inputs` returns for this
 * fixture's own `paperIndex.teams` inputs (home 197, away 2117), so the
 * payload is the one today's producer would serve for the game.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import { roundNumber } from '../src/utils/misc';
import { loadGzJson, locals, parseTable } from './helpers/tables';

const IMPACT: Record<string, number> = {
    success: -7.30226,
    explosive: -4.058488,
    explosive_epa: -42.381306,
    opp_conversion: -24.007154,
    pts_per_opp: -2.219311,
    field_position: 33.034883,
    havoc: -1.257118,
    turnovers: 12.889572,
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
const fmt = (v: number) => `${v >= 0 ? '+' : ''}${roundNumber(v, 2, 1)}`;

const game = loadGzJson('usage-cfb-400869270.json.gz');
const competitors = game.header.competitions[0].competitors;
const homeTeam = competitors.find((c: any) => c.homeAway === 'home').team;
const awayTeam = competitors.find((c: any) => c.homeAway === 'away').team;

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

const render = async (result: any) => {
    const { default: PaperIndex } = await import('../src/components/game/metrics/PaperIndex.astro');
    return parseTable(await container.renderToString(PaperIndex, {
        props: { result, homeTeam, awayTeam, completed: true }, locals: locals('cfb'),
    }));
};

describe('Deserved Win %: margin impact', () => {
    test('an Impact column, rows ordered by how far each margin moved the share', async () => {
        expect(Object.keys(IMPACT).sort()).toEqual(Object.keys(game.paperIndex.margins).sort());
        const { headers, rows, rowHtml } = await render({ ...game.paperIndex, impact: IMPACT });
        expect(headers).toEqual(['Margin', '', 'Impact']);
        const body = rows.slice(1);
        expect(body).toHaveLength(8);
        const order = Object.keys(IMPACT).sort((a, b) => Math.abs(IMPACT[b]) - Math.abs(IMPACT[a]));
        expect(body.map((r) => r[0])).toEqual(order.map((k) => LABELS[k]));
        expect(Math.abs(IMPACT[order[0]])).toBe(Math.max(...Object.values(IMPACT).map(Math.abs)));
        order.forEach((k, i) => {
            expect(body[i][2], k).toBe(`${fmt(IMPACT[k])} pts`);
            expect(rowHtml[i + 1].match(/<td[^>]*>/g)?.[2]).toContain(IMPACT[k] >= 0 ? 'var(--bs-green)' : 'var(--bs-purple)');
        });
    }, 30_000);

    test('a payload without impact keeps the two-column table in display order', async () => {
        const { headers, rows } = await render(game.paperIndex);
        expect(headers).toEqual(['Margin', '']);
        expect(rows.slice(1).map((r) => r[0])).toEqual(Object.values(LABELS));
        expect(rows.slice(1).every((r) => r.length === 2)).toBe(true);
    }, 30_000);
});
