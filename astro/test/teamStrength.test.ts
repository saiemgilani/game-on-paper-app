// BB-G24: team strength (adjusted net, SOS, SOV, pace) in the team season block, behind 'bball-team-strength'. Real
// Data API reads only (fixtures/README.md: team-strength-2026.json, and BB-G5's team-season-*.json.gz). Flag off, the
// block is BB-G5's byte for byte: the __team_strength__ snapshots were written by BB-G5's template (#400's head).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

// vitest.config sets SDV_AUTH_TOKEN='test': an unmocked read would send a real failed-auth request
// against the Data API from this IP (429 lockout). A fetch here fails the file instead.
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

import TeamSeasonBlock from '../src/components/nba/TeamSeasonBlock.astro';
import { FLAGS } from '../src/utils/features';

const capture = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const NBA = capture('team-season-nba-2026'); // Brooklyn Nets 2025-26 (stats id 1610612751, ESPN 17)
const MBB = capture('team-season-mbb-2026'); // Duke 2025-26 (ESPN 150)
// one team_strength row per league, 2026: the Nets, Duke, the Las Vegas Aces (1611661319) and UConn (41)
const STRENGTH = JSON.parse(readFileSync(new URL('./fixtures/team-strength-2026.json', import.meta.url)).toString()) as Record<string, any[]>;
const reads = (c: any, st: any) => ({ rates: c.rates, strength: st, games: [...c.home, ...c.away], gameRates: c.gameRates });

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const normalize = (html: string) => html.replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
// `on`: an admin's per-request override; { preview }: no override, the flag's own state for a (non-)preview viewer
const render = async (data: unknown, league: string, espnId: number, on: boolean | { preview: boolean }) => normalize(await container.renderToString(TeamSeasonBlock, {
    props: { data, season: 2026, espnId, teamName: 'Team' },
    locals: (typeof on === 'boolean' ? { league, preview: true, flagOverrides: { 'bball-team-strength': on } } : { league, ...on }) as unknown as App.Locals,
}));
const table = (html: string) => html.split('id="season-strength"')[1].split('</table>')[0];
const cells = (row: string) => [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);

describe('the captures', () => {
    test('one row per league; every game and every win is against a rated opponent (sos_n = games, sov_n = wins)', () => {
        for (const lg of ['nba', 'mbb', 'wnba', 'wbb']) {
            expect(STRENGTH[lg]).toHaveLength(1);
            const st = STRENGTH[lg][0];
            expect(st.season).toBe(2026);
            expect(st.wins + st.losses).toBe(st.games);
            expect(st.sos_n).toBe(st.games);
            expect(st.sov_n).toBe(st.wins);
            for (const k of ['adj_net_rtg', 'sos', 'sov']) expect(st[`${k}_rank`]).toBeGreaterThanOrEqual(1);
        }
    });
    test("BB-G5's reads agree: the record and adjusted net, and the all split's pace is team_strength's", () => {
        for (const [c, lg] of [[NBA, 'nba'], [MBB, 'mbb']] as const) {
            const st = STRENGTH[lg][0];
            const old = c.strength[0];
            for (const k of ['wins', 'losses', 'adj_net_rtg', 'adj_net_rtg_rank', 'adj_net_rtg_pct']) expect(st[k]).toBe(old[k]);
            const all = c.rates.find((r: any) => r.split === 'all');
            expect(all.pace).toBeCloseTo(st.pace, 9);
            expect(all.pace_rank).toBe(st.pace_rank);
        }
    });
});

describe("'bball-team-strength'", () => {
    test('is a preview flag', () => { expect(FLAGS['bball-team-strength']).toBe('preview'); });
    test('with no override: a preview viewer sees the table, a public viewer does not', async () => {
        expect(await render(reads(NBA, STRENGTH.nba[0]), 'nba', 17, { preview: true })).toContain('id="season-strength"');
        expect(await render(reads(NBA, STRENGTH.nba[0]), 'nba', 17, { preview: false })).not.toContain('season-strength');
    });
    test("off: BB-G5's block, byte for byte (NBA and college)", async () => {
        await expect(await render(reads(NBA, STRENGTH.nba[0]), 'nba', 17, false)).toMatchFileSnapshot('./__team_strength__/block-off-nba.html');
        await expect(await render(reads(MBB, STRENGTH.mbb[0]), 'mbb', 150, false)).toMatchFileSnapshot('./__team_strength__/block-off-mbb.html');
    });
    test('on, the Nets: adjusted net, SOS, SOV and pace with their ranks; pace is not shaded', async () => {
        const t = table(await render(reads(NBA, STRENGTH.nba[0]), 'nba', 17, true));
        const [head, value, rank] = t.split('<tr').slice(1);
        expect([...head.matchAll(/<abbr[^>]*>([^<]*)<\/abbr>/g)].map((m) => m[1])).toEqual(['Adj. net', 'SOS', 'SOV', 'Pace']);
        expect(cells(value)).toEqual(['-8.3', '+0.3', '-2.8', '97.1']);
        expect(cells(rank)).toEqual(['29', '5', '28', '26']);
        expect(value.match(/hulk-bg-level-\d/g)).toHaveLength(3);
        expect(value.split('<td').at(-1)).not.toMatch(/hulk-bg-level/);
        expect(head).toContain('82 games against a rated opponent');
        expect(head).toContain('20 wins against a rated opponent');
        expect(head).toContain('Possessions per 48 minutes');
    });
    test('on, Duke: Adj. EM and tempo move from the adjusted line into the table, once each', async () => {
        const html = await render(reads(MBB, STRENGTH.mbb[0]), 'mbb', 150, true);
        const t = table(html);
        expect(cells(t.split('<tr')[2])).toEqual(['+45.4', '+18.9', '+17.9', '67.1']);
        expect(cells(t.split('<tr')[3])).toEqual(['2', '16', '4', '284']);
        expect(t).toContain('>Adj. EM<');
        expect(t).toContain('>Tempo<');
        expect(t).toContain('Possessions per 40 minutes');
        expect(html.match(/Adj\. EM/g)).toHaveLength(1);
        expect(html.match(/Tempo/g)).toHaveLength(1);
        expect(html.split('id="season-adjusted"')[1].split('</p>')[0]).toContain('Adj. D');
    });
    test('on, with no team_strength row: no table, and the rest of the block renders', async () => {
        const html = await render(reads(NBA, null), 'nba', 17, true);
        expect(html).not.toContain('season-strength');
        expect(html).toContain('id="season-rates"');
    });
});
