/**
 * Review on #336: a conference with divisions (the Sun Belt) renders as ONE
 * table with a heading row per division, PlayerBoxScore-style, and a meme-list
 * team's mobile abbreviation is lowercased like its name.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test, vi } from 'vitest';
import StandingsTable from '../src/components/StandingsTable.astro';
import { loadStandings } from '../src/utils/standings';

const capture = (g: string) =>
    JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/standings-cfb-${g}-2026.json.gz`, import.meta.url))).toString());
vi.mock('../src/resources/espn', () => ({
    retrieveConferenceStandings: async (g: string) => (['8', '37'].includes(String(g)) ? capture(String(g)) : null),
}));

describe('StandingsTable', () => {
    test('the Sun Belt is one table: a heading row per division, no "Team" header', async () => {
        const [, belt] = await loadStandings('cfb');
        const html = await (await AstroContainer.create()).renderToString(StandingsTable, { props: { league: 'cfb', sections: belt.divisions } });
        expect(html.match(/<table/g)).toHaveLength(1);
        expect([...html.matchAll(/gt_group_heading[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(['Sun Belt - East', 'Sun Belt - West']);
        expect(html).not.toMatch(/<th[^>]*>Team<\/th>/);
    });

    test('a plain conference keeps its "Team" header; a meme-list abbreviation is lowercased', async () => {
        const [sec] = await loadStandings('cfb');
        const html = await (await AstroContainer.create()).renderToString(StandingsTable, { props: { league: 'cfb', sections: [{ rows: sec.rows }] } });
        expect(html).toMatch(/<th[^>]*>Team<\/th>/);
        expect(html).not.toContain('gt_group_heading');
        expect(html).toContain('<span class="d-sm-none">uga</span>');
        expect(html).toContain('<span class="d-sm-none">ALA</span>');
    });
});
