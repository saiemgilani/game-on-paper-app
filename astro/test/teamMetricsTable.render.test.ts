/**
 * The v2 Team Stats table puts each cell under the team it belongs to.
 *
 * The header teams come from the FIRST section of the box; every row then reads
 * its own section. Two things used to break the pairing (review on #270):
 *
 *  - sections that list the teams in different orders (the processor's own
 *    payload does: `team` and `drive_scripting` below are opposite), and
 *  - a team with no row at all for a script. Early in a game one side has run
 *    only scripted drives, or none yet, and its row is simply absent.
 *
 * Both are read here off the rendered markup, on a real processed game.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import { roundNumber } from '../src/utils/misc';
import { loadGzJson, locals } from './helpers/tables';

const g = loadGzJson('usage-cfb-400869270.json.gz');
const TEAM: any[] = g.advBoxScore.team;
const SCRIPTING: any[] = g.advBoxScore.drive_scripting;
const DRIVES: any[] = g.advBoxScore.drives;

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const render = async (box: Record<string, any[]>, column: string) => {
    const { default: Table } = await import('../src/components/game/metrics/TeamMetricsTable.svelte');
    return container.renderToString(Table as any, {
        props: { title: 'Drives', league: 'cfb', teamKey: 'pos_team', season: g.season.year, columns: [column], box, useSuffix: false, decimalPoints: 2 },
        locals: locals('cfb'),
    });
};
const headerTeams = (html: string) => [...html.matchAll(/<th[^>]*>\s*<a[^>]*\/team\/(\d+)"/g)].map((m) => m[1]);
const cells = (html: string) => [...html.matchAll(/<td class="numeral"[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
const epa = (rows: any[], team: string, script: string) => {
    const row = rows.find((r) => String(r.pos_team) === team && r.script === script);
    return row ? roundNumber(row.epa_per_play, 2, 2) : '—';
};

describe('drive scripting rows', () => {
    test('the fixture is a real test of it: opposite section orders, different values', () => {
        expect(String(SCRIPTING[0].pos_team)).not.toBe(String(TEAM[0].pos_team));
        const [a, b] = TEAM.map((t) => epa(SCRIPTING, String(t.pos_team), 'scripted'));
        expect(a).not.toBe(b);
    });

    for (const script of ['scripted', 'non_scripted']) {
        test(`${script}: each cell is its header team's own number`, async () => {
            const html = await render({ team: TEAM, drive_scripting: SCRIPTING }, `drive_scripting.${script}.epa_per_play`);
            const teams = headerTeams(html);
            expect(teams).toEqual(TEAM.map((t) => String(t.pos_team)));
            expect(cells(html)).toEqual(teams.map((t) => epa(SCRIPTING, t, script)));
        }, 60_000);
    }

    test('a team with no scripted drive yet gets a dash, and the other team keeps its own column', async () => {
        const [first, second] = TEAM.map((t) => String(t.pos_team));
        const rows = SCRIPTING.filter((r) => !(String(r.pos_team) === first && r.script === 'scripted'));
        const html = await render({ team: TEAM, drive_scripting: rows }, 'drive_scripting.scripted.epa_per_play');
        expect(cells(html)).toEqual(['—', epa(SCRIPTING, second, 'scripted')]);
    }, 60_000);

    test('a span with no drive rows at all prints dashes, never zeros', async () => {
        const html = await render({ team: TEAM, drive_scripting: [] }, 'drive_scripting.non_scripted.drives');
        expect(cells(html)).toEqual(['—', '—']);
    }, 60_000);
});

describe('any other section', () => {
    test('a section listed in the opposite order to the header still lines up', async () => {
        const teams = TEAM.map((t) => String(t.pos_team));
        const reversed = teams.toReversed().map((t) => DRIVES.find((r) => String(r.pos_team) === t));
        expect(reversed.every(Boolean)).toBe(true);
        const html = await render({ team: TEAM, drives: reversed }, 'drives.plays_per_drive');
        const want = teams.map((t) => DRIVES.find((r) => String(r.pos_team) === t).plays_per_drive);
        expect(want[0]).not.toBe(want[1]);
        expect(cells(html).map(Number)).toEqual(want.map((v: number) => Number(roundNumber(v, 2, 2))));
    }, 60_000);
});
