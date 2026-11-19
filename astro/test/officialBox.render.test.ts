import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

// PlayerBoxScore on a real 2026 box (fixtures/official-box-2026.json.gz): the stat lines
// print ESPN's counts on the full game and the play-by-play's on a window.
const FX: Record<string, any> = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/official-box-2026.json.gz', import.meta.url))).toString());

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create();
});

const render = async (box: any, teamId: number, espn: boolean, league = 'cfb') => {
    const { default: PlayerBoxScore } = await import('../src/components/game/metrics/PlayerBoxScore.astro');
    const of = (k: string) => (box[k] ?? []).filter((r: any) => r.pos_team == teamId);
    return container.renderToString(PlayerBoxScore, {
        props: {
            pass: of('pass'), rush: of('rush'), receiver: of('receiver'),
            kickers: of('st_kickers'), punters: of('st_punters'), returners: of('st_returners'),
            plays: [], teamId, box, season: 2026, league,
            espn: espn ? box.espn_players : undefined,
        },
    });
};
const lineUnder = (html: string, name: string) => [...html.matchAll(new RegExp(
    `>${name}</a></td>(?:<td class="numeral"[^>]*>[^<]*</td>){5}</tr><tr class="stat-line-row"><td colspan="6" class="text-muted">(.*?)</td>`, 'g'))]
    .map((m) => m[1].replace(/<[^>]+>/g, ''));

describe('PlayerBoxScore prints the official book on the full game', () => {
    test('CFB 401856889: Jared Curtis passes 25/40 and rushes 9 for -18 (ESPN), not 25/41 and 4 for 9 (pbp)', async () => {
        const html = await render(FX.cfb_401856889, 238, true);
        const [passLine, rushLine] = lineUnder(html, 'Jared Curtis')!;
        expect(passLine).toMatch(/^25\/40, 223 yds, 0 TD, 0 INT/);
        expect(rushLine).toMatch(/^9 car, -18 yds, 0 TD/);
        expect(html).not.toContain('(play-by-play)</span><span title="Longest carry');
    });

    test('NFL 401873054: Cade Klubnik 11/20, 137 yds, 1 INT, 3 Sck (ESPN), not 12/20 134 0 INT', async () => {
        const html = await render(FX.nfl_401873054, 20, true, 'nfl');
        expect(lineUnder(html, 'Cade Klubnik')![0]).toMatch(/^11\/20, 137 yds, 0 TD, 1 INT, 3 Sck/);
    });

    test('a window (no ESPN rows) keeps the play-by-play counts, unmarked', async () => {
        const html = await render(FX.cfb_401856889, 238, false);
        expect(html).toMatch(/Jared Curtis(<\/a>)?<\/td>[\s\S]*?25\/41, 223 yds/);
        expect(html).not.toContain('(play-by-play)');
    });

    test('a line ESPN does not list is marked', async () => {
        // the Alabama team rush row (a pbp artifact) has no ESPN line
        const html = await render(FX.cfb_401856889, 333, true);
        expect(html).toMatch(/Alabama<\/td>[\s\S]*?1 car, -4 yds, 0 TD[^<]*<span title="Not in ESPN's box score: counted from the play-by-play."> \(play-by-play\)<\/span>/);
    });
});
