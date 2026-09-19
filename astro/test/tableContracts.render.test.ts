/**
 * Render-level table contract tests for the game page (plan V3b).
 *
 * Three things, on a real processed game for both leagues:
 *
 *  1. CONTRACT — every table cell is compared against the payload field its
 *     header claims to show, after the same `roundNumber`/`pct`/`signed`
 *     formatting the component applies. A table that quietly renders a
 *     different field than its header names fails here.
 *  2. TWIN PARITY — the classic twin (`components/game/classic/**`, what the
 *     public sees) and the v2 twin render the same numbers for the same
 *     payload. Sections that exist in only one twin are listed in the PR body,
 *     not failed.
 *  3. AGGREGATION RECONCILIATION — where the page computes from plays (drive
 *     rates, per-play means) the displayed value is recomputed from the
 *     payload's plays; where it reads `advBoxScore`, the team totals are
 *     checked against the sum over qualifying plays. This is the GOP mirror of
 *     the plan's V1b.
 *
 * The fixtures are real, offline and deterministic: `usage-<league>-<id>.json.gz`
 * is the exact `/{league}/{id}/process` body (see test/fixtures/README.md).
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import {
    BOX_SCORE_NON_RATE_COLUMNS,
    BOX_SCORE_NON_RATE_DECIMAL_COLUMNS,
    BOX_SCORE_NON_RATE_PERCENT_COLUMNS,
    METRIC_KEY_TITLE_MAPPING,
} from '../src/utils/constants';
import { roundNumber } from '../src/utils/misc';
import { madeOf, num, pct, scriptSplit, signed, sortDesc, teamRows } from '../src/utils/usage';
import { isScrimmage } from '../src/utils/situational';
import { loadGzJson, locals, numbers, parseTable, text } from './helpers/tables';

const FIXTURES = {
    cfb: { file: 'usage-cfb-400869270.json.gz', id: 400869270 },
    nfl: { file: 'usage-nfl-401872922.json.gz', id: 401872922 },
} as const;
type Lg = keyof typeof FIXTURES;

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const games: Record<string, any> = {};
const game = (league: Lg) => (games[league] ??= loadGzJson(FIXTURES[league].file));

/** The eight team-metric tables, exactly as both GamePage twins configure them. */
const METRIC_TABLES = [
    { title: 'Expected Points', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['EPA_plays', 'EPA_overall_total', 'EPA_overall_offense', 'EPA_special_teams', 'EPA_penalty'] },
    { title: 'Production', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['scrimmage_plays', 'off_yards', 'yards_per_play', 'EPA_overall_off', 'EPA_per_play', 'passes', 'pass_yards', 'yards_per_pass', 'EPA_passing_overall', 'EPA_passing_per_play', 'rushes', 'rush_yards', 'yards_per_rush', 'EPA_rushing_overall', 'EPA_rushing_per_play'] },
    { title: 'Rushing', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['scrimmage_plays', 'rushes', 'rushing_power', 'rushing_power_success', 'rushing_stuff', 'rushing_stopped', 'rushing_opportunity', 'line_yards', 'line_yards_per_carry', 'rushing_highlight_yards', 'rushing_highlight_yards_per_opp'] },
    { title: 'Explosiveness', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['EPA_plays', 'scrimmage_plays', 'EPA_explosive', 'EPA_explosive_passing', 'EPA_explosive_rushing', 'EPA_non_explosive', 'EPA_non_explosive_per_play', 'EPA_non_explosive_passing', 'EPA_non_explosive_passing_per_play', 'EPA_non_explosive_rushing', 'EPA_non_explosive_rushing_per_play'] },
    { title: 'Situational', section: 'situational', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['EPA_success', 'EPA_success_pass', 'EPA_success_rush', 'EPA_success_standard_down', 'EPA_success_passing_down', 'EPA_success_early_down', 'EPA_success_late_down', 'EPA_middle_8_success', 'early_downs', 'early_down_first_down', 'EPA_early_down', 'EPA_early_down_per_play', 'early_down_pass', 'early_down_rush', 'EPA_success_early_down_pass', 'EPA_success_early_down_rush', 'late_downs', 'EPA_late_down', 'EPA_late_down_per_play', 'late_down_pass', 'late_down_rush', 'EPA_success_late_down_pass', 'EPA_success_late_down_rush', 'late_down_avg_distance', 'middle_8', 'EPA_middle_8', 'EPA_middle_8_per_play', 'middle_8_pass', 'middle_8_rush', 'EPA_middle_8_success_pass', 'EPA_middle_8_success_rush'] },
    { title: 'Drives', section: 'drives', teamKey: 'pos_team', useSuffix: false, decimalPoints: 2, columns: ['drives', 'avg_field_position', 'plays_per_drive', 'yards_per_drive', 'drive_total_gained_yards_rate'] },
    { title: 'Defensive', section: 'defensive', teamKey: 'def_pos_team', useSuffix: true, decimalPoints: 0, columns: ['scrimmage_plays', 'drive_stopped_rate', 'havoc_total', 'havoc_total_pass', 'havoc_total_rush', 'TFL', 'TFL_pass', 'TFL_rush', 'sacks', 'PD', 'def_int', 'fumbles'] },
    { title: 'Turnovers', section: 'turnover', teamKey: 'pos_team', useSuffix: false, decimalPoints: 0, columns: ['turnovers', 'total_fumbles', 'fumbles_lost', 'fumbles_recovered', 'Int', 'turnover_margin', 'expected_turnovers', 'expected_turnover_margin', 'turnover_luck'] },
] as const;

/**
 * What the cell for `key` must read, derived straight from the payload row.
 *
 * The branch order is the contract the two TeamMetricsTable twins share: a
 * percent column, then a fixed-decimal column, then a bare count, and anything
 * else is "count (rate%)".
 */
function expectedMetricCell(key: string, row: any, useSuffix: boolean, decimalPoints: number): string {
    const dp = decimalPoints || 1;
    if (key === 'avg_field_position') {
        const v = row[key] || 0;
        return `${v >= 50 ? 'Own' : 'Opp'} ${roundNumber(v >= 50 ? 100 - parseFloat(v) : v, 2, 0)}`;
    }
    if (BOX_SCORE_NON_RATE_PERCENT_COLUMNS.includes(key)) return `${roundNumber(parseFloat(row[key] || 0), 2, 0)}%`;
    if (BOX_SCORE_NON_RATE_DECIMAL_COLUMNS.includes(key)) return roundNumber(parseFloat(row[key] || 0), 2, dp);
    if (BOX_SCORE_NON_RATE_COLUMNS.includes(key)) return String(row[key] || 0);
    const val = row[key] || 0;
    const rate = useSuffix ? 100.0 * row[`${key}_rate`] : 100.0 * (parseFloat(val) / parseFloat(row['scrimmage_plays']));
    return `${val} (${roundNumber(rate, 2, 0)}%)`;
}

async function renderMetricTable(twin: 'classic' | 'v2', league: Lg, cfg: (typeof METRIC_TABLES)[number]) {
    const g = game(league);
    const props = {
        title: cfg.title,
        teamKey: cfg.teamKey,
        season: g.season.year,
        columns: [...cfg.columns],
        teamBoxScores: g.advBoxScore[cfg.section],
        useSuffix: cfg.useSuffix,
        decimalPoints: cfg.decimalPoints,
    };
    const mod = twin === 'classic'
        ? await import('../src/components/game/classic/TeamMetricsTable.astro')
        : await import('../src/components/game/metrics/TeamMetricsTable.svelte');
    return container.renderToString(mod.default as any, { props, locals: locals(league) });
}

for (const league of Object.keys(FIXTURES) as Lg[]) {
    describe(`[${league}] team metric tables show the field their row label names`, () => {
        for (const cfg of METRIC_TABLES) {
            test(`${cfg.title}: every cell equals its payload field`, async () => {
                const g = game(league);
                const rowsData: any[] = g.advBoxScore[cfg.section];
                expect(rowsData.length, `${cfg.section} has rows`).toBeGreaterThan(0);
                const html = await renderMetricTable('classic', league, cfg);
                const { rows } = parseTable(html);
                // row 0 is the header (title + one logo per team)
                const body = rows.slice(1);
                expect(body).toHaveLength(cfg.columns.length);
                cfg.columns.forEach((key, i) => {
                    const [label, ...cells] = body[i];
                    expect(label, `row ${i} label`).toBe(text(METRIC_KEY_TITLE_MAPPING[key] || key));
                    expect(cells).toHaveLength(rowsData.length);
                    cells.forEach((cell, t) => {
                        expect(cell, `${cfg.title} / ${key} / team ${rowsData[t][cfg.teamKey]}`)
                            .toBe(expectedMetricCell(key, rowsData[t], cfg.useSuffix, cfg.decimalPoints));
                    });
                });
            }, 30_000);
        }

        test('the team columns are in the payload order, one per box row', async () => {
            const g = game(league);
            const html = await renderMetricTable('classic', league, METRIC_TABLES[0]);
            const ids = [...html.matchAll(/team-logo-(\d+)/g)].map((m) => m[1]);
            expect(ids).toEqual(g.advBoxScore.team.map((r: any) => String(r.pos_team)));
        }, 30_000);
    });

    describe(`[${league}] twin parity: classic vs v2`, () => {
        for (const cfg of METRIC_TABLES) {
            test(`${cfg.title} renders identical numbers in both twins`, async () => {
                const [classic, v2] = await Promise.all([
                    renderMetricTable('classic', league, cfg),
                    renderMetricTable('v2', league, cfg),
                ]);
                const strip = (h: string) => parseTable(h).rows.slice(1).map((r) => r.join('|'));
                expect(strip(v2)).toEqual(strip(classic));
            }, 30_000);
        }

        test('PlayerBoxScore: the five numeric columns agree in both twins', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const box = {
                pass: g.advBoxScore.pass.filter((r: any) => r.pos_team == teamId),
                rush: g.advBoxScore.rush.filter((r: any) => r.pos_team == teamId),
                receiver: g.advBoxScore.receiver.filter((r: any) => r.pos_team == teamId),
            };
            const classic = await container.renderToString(
                (await import('../src/components/game/classic/PlayerBoxScore.astro')).default,
                { props: { ...box }, locals: locals(league) });
            const v2 = await container.renderToString(
                (await import('../src/components/game/metrics/PlayerBoxScore.astro')).default,
                { props: { ...box, plays: g.plays, teamId }, locals: locals(league) });
            // the last five cells of a player row are Yards/play, EPA/play, EPA, SR, WPA;
            // the stat-line cell differs by design (v2 appends LNG / best-play extremes)
            const tail = (h: string) => parseTable(h).rows.filter((r) => r.length === 7).map((r) => r.slice(2).join('|'));
            const c = tail(classic);
            expect(c.length).toBeGreaterThan(3);
            // v2 also renders a Defense block the classic twin has no equivalent for;
            // compare the rows the classic twin actually has, in order.
            expect(tail(v2).slice(0, c.length)).toEqual(c);
        }, 30_000);
    });

    describe(`[${league}] the player box and the Binion box read their box rows`, () => {
        test('PlayerBoxScore: every player line equals its advBoxScore row', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const pick = (section: string) => g.advBoxScore[section]
                .filter((r: any) => r.pos_team == teamId)
                .filter((r: any) => (r[`${{ pass: 'passer', rush: 'rusher', receiver: 'receiver' }[section]}_player_name`]?.length ?? 0) > 0)
                .toSorted((a: any, b: any) => b.EPA - a.EPA);
            const [pass, rush, receiver] = ['pass', 'rush', 'receiver'].map(pick);
            const html = await container.renderToString(
                (await import('../src/components/game/classic/PlayerBoxScore.astro')).default,
                { props: { pass, rush, receiver }, locals: locals(league) });
            const { rows } = parseTable(html);
            const body = rows.filter((r) => r.length === 7 && r[1] !== 'Stat line');
            // group headings are single-cell rows, so the player rows arrive in
            // section order: dropbacks, then rushes, then targets
            const expected = [
                ...pass.map((p: any) => [p.passer_player_name, p.YPA, p]),
                ...rush.map((p: any) => [p.rusher_player_name, p.YPC, p]),
                ...receiver.map((p: any) => [p.receiver_player_name, p.YPT, p]),
            ];
            expect(body).toHaveLength(expected.length);
            expect(expected.length).toBeGreaterThan(5);
            expected.forEach(([name, perPlay, p]: any, i) => {
                const c = body[i];
                expect(c[0], `row ${i} name`).toBe(String(name));
                expect(c[2], `${name} yards/play`).toBe(roundNumber(perPlay || 0, 2, 2));
                expect(c[3], `${name} EPA/play`).toBe(roundNumber(p.EPA_per_Play, 2, 2));
                expect(c[4], `${name} EPA`).toBe(roundNumber(p.EPA, 2, 2));
                expect(c[5], `${name} SR`).toBe(`${roundNumber(p.SR * 100, 2, 0)}%`);
                expect(c[6], `${name} WPA`).toBe(`${roundNumber(p.WPA * 100, 2, 1)}%`);
            });
        }, 30_000);

        test('BinionBoxScore: each row reads the section its label names', async () => {
            const g = game(league);
            const html = await container.renderToString(
                (await import('../src/components/game/classic/BinionBoxScore.astro')).default,
                { props: { season: g.season.year, advancedBoxScore: g.advBoxScore, percentiles: [] }, locals: locals(league) });
            const { rows } = parseTable(html);
            const body = rows.slice(1);
            const COLUMNS: [string, string, string][] = [
                // [key, section, label]
                ['EPA_per_play', 'team', 'EPA/Play'],
                ['EPA_success', 'situational', 'Success Rate'],
                ['yards_per_play', 'team', 'Yards/Play'],
                ['EPA_passing_per_play', 'team', 'EPA/Dropback'],
                ['EPA_rushing_per_play', 'team', 'EPA/Rush'],
                ['yards_per_pass', 'team', 'Yards/Dropback'],
                ['EPA_explosive', 'team', 'Explosive Play Rate'],
                ['EPA_success_rate_third', 'situational', '3rd Down Success Rate'],
                ['EPA_success_rate_rz', 'situational', 'Red Zone Success Rate'],
                ['rushing_stuff', 'team', 'Def Run Stuff Rate'],
                ['havoc_total', 'defensive', 'Havoc Rate'],
            ];
            expect(body).toHaveLength(COLUMNS.length);
            COLUMNS.forEach(([key, section, label], i) => {
                const cells = body[i];
                expect(cells[0], `row ${i} label`).toBe(label);
                // the run-stuff row is deliberately shown against the other team
                const src = key === 'rushing_stuff' ? [...g.advBoxScore[section]].reverse() : g.advBoxScore[section];
                src.forEach((row: any, t: number) => {
                    const v = parseFloat(row[key] ?? '0');
                    const expectedStart = BOX_SCORE_NON_RATE_PERCENT_COLUMNS.includes(key)
                        ? `${roundNumber(v * (key.includes('_third') || key.includes('_rz') ? 100 : 1), 2, 0)}%`
                        : BOX_SCORE_NON_RATE_DECIMAL_COLUMNS.includes(key)
                            ? roundNumber(v, 2, 2)
                            : BOX_SCORE_NON_RATE_COLUMNS.includes(key)
                                ? String(v)
                                : `${roundNumber(100 * parseFloat(row[`${key}_rate`]), 2, 0)}%`;
                    expect(cells[1 + t].split(' ')[0], `${label} / team ${t}`).toBe(expectedStart);
                });
            });
        }, 30_000);

        test('BinionBoxScore renders identical numbers in both twins', async () => {
            const g = game(league);
            const props = { season: g.season.year, advancedBoxScore: g.advBoxScore, percentiles: [] };
            const [classic, v2] = await Promise.all([
                container.renderToString((await import('../src/components/game/classic/BinionBoxScore.astro')).default, { props, locals: locals(league) }),
                container.renderToString((await import('../src/components/game/metrics/BinionBoxScore.svelte')).default as any, { props: { ...props, league }, locals: locals(league) }),
            ]);
            const strip = (h: string) => parseTable(h).rows.slice(1).map((r) => r.join('|'));
            expect(strip(v2)).toEqual(strip(classic));
        }, 30_000);
    });

    describe(`[${league}] usage, situational and special-teams tables (#252)`, () => {
        test('UsageBoxScore: each player row reads its player_usage fields', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/UsageBoxScore.astro')).default,
                { props: { box: g.advBoxScore, teamId }, locals: locals(league) });
            const usage = sortDesc(teamRows(g.advBoxScore.player_usage, teamId), 'opportunities');
            expect(usage.length).toBeGreaterThan(3);
            const { rows } = parseTable(html, 0);
            const body = rows.slice(1).slice(0, usage.length);
            usage.forEach((p: any, i) => {
                const cells = body[i];
                expect(cells[0], `row ${i} name`).toContain(p.player_name);
                expect(cells[1]).toBe(String(p.opportunities));
                expect(cells[2]).toBe(pct(p.target_share, 0));
                expect(cells[3]).toBe(pct(p.first_down_share, 0));
                expect(cells[4]).toBe(pct(p.fd_td_rate, 0));
                expect(cells[5]).toBe(pct(p.explosive_rate, 0));
                expect(cells[6]).toBe(`${p.rz_touches} (${p.rz_touchdowns})`);
                expect(cells[7]).toBe(`${p.so_touches} (${p.so_touchdowns})`);
                expect(cells[8]).toBe(p.third_down_opportunities > 0 ? signed(p.third_down_over_expected) : '—');
            });
        }, 30_000);

        test('UsageBoxScore: the tackle table reads the tackles section', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const tackles = sortDesc(teamRows(g.advBoxScore.tackles, teamId, 'def_pos_team'), 'tackle_share');
            if (tackles.length === 0) return; // cfb fixture carries no participants
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/UsageBoxScore.astro')).default,
                { props: { box: g.advBoxScore, teamId }, locals: locals(league) });
            const { rows } = parseTable(html, 1);
            const body = rows.slice(1).slice(0, tackles.length);
            tackles.forEach((t: any, i) => {
                expect(body[i][0]).toContain(t.player_name);
                expect(body[i][1]).toBe(String(t.tackles));
                expect(body[i][2]).toBe(String(t.assists));
                expect(body[i][3]).toBe(pct(t.tackle_share, 0));
            });
        }, 30_000);

        test('SituationalSplits: every labelled row reads the section it names', async () => {
            const g = game(league);
            const [home, away] = [g.header.competitions[0].competitors[0].team, g.header.competitions[0].competitors[1].team];
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/SituationalSplits.astro')).default,
                { props: { box: g.advBoxScore, awayTeam: away, homeTeam: home }, locals: locals(league) });
            const { rows } = parseTable(html);
            const byLabel = new Map(rows.map((r) => [r[0], r.slice(1)]));
            const teams = [away, home];
            const usage = teams.map((t) => teamRows(g.advBoxScore.team_usage, t.id)[0]);
            const st = teams.map((t) => teamRows(g.advBoxScore.st_team, t.id)[0]);
            const scripts = teams.map((t) => scriptSplit(g.advBoxScore.drive_scripting as any[], t.id));
            expect(usage.every(Boolean), 'both teams have a team_usage row').toBe(true);

            expect(byLabel.get('3rd downs')).toEqual(usage.map((u: any) => `${madeOf(u.third_down_conversions, u.third_down_opportunities)} (exp ${num(u.third_down_expected, 1)})`));
            expect(byLabel.get('Red-zone trips')).toEqual(usage.map((u: any) => String(u.rz_trips ?? 0)));
            expect(byLabel.get('Red-zone TD rate')).toEqual(usage.map((u: any) => pct(u.rz_touchdown_rate, 0)));
            expect(byLabel.get('Red-zone points per trip')).toEqual(usage.map((u: any) => num(u.rz_points_per_trip, 2)));
            expect(byLabel.get('Red-zone EPA/play')).toEqual(usage.map((u: any) => num(u.rz_epa_per_play, 2)));
            expect(byLabel.get('Scoring-opp trips')).toEqual(usage.map((u: any) => String(u.so_trips ?? 0)));
            expect(byLabel.get('Scoring-opp TD rate')).toEqual(usage.map((u: any) => pct(u.so_touchdown_rate, 0)));
            expect(byLabel.get('Scoring-opp EPA/play')).toEqual(usage.map((u: any) => num(u.so_epa_per_play, 2)));
            expect(byLabel.get('Field goals')).toEqual(st.map((s: any) => `${madeOf(s.fg_made, s.fg_attempts)}${s.fgs_blocked > 0 ? ` (${s.fgs_blocked} blocked)` : ''}`));
            expect(byLabel.get('Kickoff touchback rate')).toEqual(st.map((s: any) => pct(s.kickoff_touchback_rate, 0)));
            expect(byLabel.get('Net punt average')).toEqual(st.map((s: any) => num(s.punt_net_avg, 1)));
            expect(byLabel.get('Scripted drives')).toEqual(scripts.map((s: any) => `${s.scripted.drives} drives, ${num(s.scripted.epa_per_play, 2)} EPA/play, ${pct(s.scripted.success_rate, 0)} SR, ${num(s.scripted.points_per_drive, 2)} pts/drive`));
        }, 30_000);
    });

    describe(`[${league}] the numbers the page derives from plays reconcile`, () => {
        test('advBoxScore.team totals equal the sum over the qualifying plays', async () => {
            const g = game(league);
            for (const row of g.advBoxScore.team) {
                const mine = g.plays.filter((p: any) => p.pos_team == row.pos_team);
                const scrimmage = mine.filter((p: any) => p.scrimmage_play === true);
                const sum = (rows: any[], k: string) => rows.reduce((a, p) => a + (Number(p[k]) || 0), 0);
                // plays
                expect(row.scrimmage_plays, 'scrimmage_plays').toBe(scrimmage.length);
                expect(row.EPA_plays, 'EPA_plays').toBe(mine.filter((p: any) => p.play === true).length);
                expect(row.rushes, 'rushes').toBe(scrimmage.filter((p: any) => p.rush === true).length);
                expect(row.passes, 'passes').toBe(scrimmage.filter((p: any) => p.pass === true).length);
                // EPA. The box rounds to two decimals, so the tolerance is
                // exactly that rounding and nothing wider.
                expect(row.EPA_overall_off, 'EPA_overall_off').toBeCloseTo(sum(scrimmage, 'EPA_scrimmage'), 2);
                expect(row.EPA_rushing_overall, 'EPA_rushing_overall').toBeCloseTo(sum(scrimmage, 'EPA_rush'), 2);
                expect(row.EPA_passing_overall, 'EPA_passing_overall').toBeCloseTo(sum(scrimmage, 'EPA_pass'), 2);
                // success + explosive
                expect(row.EPA_explosive, 'EPA_explosive').toBe(sum(scrimmage, 'EPA_explosive'));
                // yards. rush_yards / pass_yards are the processor's own parsed
                // yardage; off_yards is ESPN's per-play statYardage, so the two
                // are NOT the same universe -- see the PR body. Each is pinned
                // against the plays it actually comes from.
                expect(row.rush_yards, 'rush_yards').toBe(sum(scrimmage.filter((p: any) => p.rush === true), 'yds_rushed'));
                expect(row.pass_yards, 'pass_yards').toBe(sum(scrimmage.filter((p: any) => p.pass === true), 'yds_receiving'));
                expect(Math.abs(row.off_yards - sum(scrimmage, 'statYardage')), 'off_yards vs statYardage').toBeLessThanOrEqual(1);
                // per-play means recompute from the totals the same table shows
                expect(Number(row.EPA_per_play), 'EPA_per_play').toBeCloseTo(row.EPA_overall_off / row.scrimmage_plays, 2);
                expect(Number(row.yards_per_play), 'yards_per_play').toBeCloseTo(row.off_yards / row.scrimmage_plays, 2);
            }
        });

        test('the situational box success counts equal the successful plays', () => {
            const g = game(league);
            for (const row of g.advBoxScore.situational) {
                const scrimmage = g.plays.filter((p: any) => p.pos_team == row.pos_team && p.scrimmage_play === true);
                const n = (k: string) => scrimmage.reduce((a: number, p: any) => a + (Number(p[k]) || 0), 0);
                expect(row.EPA_success, 'EPA_success').toBe(n('EPA_success'));
                expect(row.EPA_success_pass, 'EPA_success_pass').toBe(n('EPA_success_pass'));
                expect(row.EPA_success_rush, 'EPA_success_rush').toBe(n('EPA_success_rush'));
                expect(row.early_downs, 'early_downs').toBe(scrimmage.filter((p: any) => p.early_down === true).length);
                expect(row.late_downs, 'late_downs').toBe(scrimmage.filter((p: any) => p.late_down === true).length);
                expect(row.middle_8, 'middle_8').toBe(scrimmage.filter((p: any) => p.middle_8 === true).length);
            }
        });

        test('the turnover box equals the turnovers in the plays', () => {
            const g = game(league);
            for (const row of g.advBoxScore.turnover) {
                const mine = g.plays.filter((p: any) => p.pos_team == row.pos_team);
                const ints = mine.filter((p: any) => p.int === true || p.int === 1).length;
                const lost = mine.filter((p: any) => p.fumble_lost === true || p.fumble_lost === 1).length;
                expect(row.Int, 'Int').toBe(ints);
                expect(row.fumbles_lost, 'fumbles_lost').toBe(lost);
                expect(row.turnovers, 'turnovers').toBe(ints + lost);
            }
        });

        test('DrivesTable: every drive row recomputes from that drive\'s plays', async () => {
            const g = game(league);
            const drives = g.drives.previous;
            const html = await container.renderToString(
                (await import('../src/components/game/drives/DrivesTable.astro')).default,
                {
                    props: {
                        drives, gamePlays: g.plays, prefix: 'drives', expandable: true, showGuide: false,
                        homeTeam: g.teamInfo.home, awayTeam: g.teamInfo.away, isNeutralSite: false,
                    },
                    locals: locals(league),
                });
            const summary = parseTable(html).rowHtml.filter((r) => r.includes('accordion-toggle'));
            expect(summary.length).toBe(drives.filter((d: any) => g.plays.some((p: any) => p['drive.id'] == d.id)).length);
            let checked = 0;
            for (const rowHtml of summary) {
                const id = rowHtml.match(/#drive-drives-([^"]+)"/)?.[1];
                const plays = g.plays.filter((p: any) => String(p['drive.id']) === id);
                if (plays.length === 0) continue;
                const scrimmage = plays.filter(isScrimmage as any);
                const totalEPA = plays.reduce((a: number, p: any) => a + (p.EPA || 0), 0);
                const avgEPA = scrimmage.length === 0 ? 0 : scrimmage.reduce((a: number, p: any) => a + (p.EPA || 0), 0) / scrimmage.length;
                const sr = scrimmage.length === 0 ? 0 : scrimmage.reduce((a: number, p: any) => a + (Number(p.EPA_success) || 0), 0) / scrimmage.length;
                const cells = [...rowHtml.matchAll(/<td\b[\s\S]*?<\/td>/g)].map((m) => text(m[0]));
                expect(cells[4], `drive ${id} SR%`).toBe(`${roundNumber(sr * 100, 3, 0)}%`);
                expect(cells[5], `drive ${id} EPA`).toBe(`${roundNumber(totalEPA, 2, 2)} ${roundNumber(avgEPA, 2, 2)}/play`);
                expect(cells[7], `drive ${id} start WP`).toBe(`${roundNumber(plays[0].winProbability.before * 100, 3, 1)}%`);
                checked++;
            }
            expect(checked).toBeGreaterThan(10);
        }, 30_000);
    });

    describe(`[${league}] Linescore and Paper Index read the header and the fitted result`, () => {
        test('Linescore prints each period from the competitor linescores, and the final from the score', async () => {
            const g = game(league);
            const competitors = g.header.competitions[0].competitors;
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/Linescore.astro')).default,
                { props: { competitors, season: g.season.year }, locals: locals(league) });
            const { rows } = parseTable(html);
            const order = [competitors.find((c: any) => c.homeAway === 'away'), competitors.find((c: any) => c.homeAway === 'home')];
            const body = rows.slice(1);
            expect(body).toHaveLength(2);
            order.forEach((t: any, i) => {
                const cells = body[i];
                expect(cells[0]).toContain(t.team.abbreviation ?? t.team.shortDisplayName);
                t.linescores.forEach((ls: any, q: number) => expect(cells[1 + q], `period ${q + 1}`).toBe(String(ls.displayValue)));
                expect(cells[cells.length - 1], 'final').toBe(String(t.score));
                // and the periods add up to the final the header carries
                const periods = t.linescores.map((ls: any) => Number(ls.displayValue));
                expect(periods.reduce((a: number, b: number) => a + b, 0)).toBe(Number(t.score));
            });
        }, 30_000);

        test('PaperIndex: the margin rows read paperIndex.margins and the meter reads homeShare', async () => {
            const g = game(league);
            expect(g.paperIndex, 'the fixture carries a fitted paper index').toBeTruthy();
            const [home, away] = [g.header.competitions[0].competitors[0].team, g.header.competitions[0].competitors[1].team];
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/PaperIndex.astro')).default,
                { props: { result: g.paperIndex, homeTeam: home, awayTeam: away, completed: true }, locals: locals(league) });
            const m = g.paperIndex.margins;
            const fmt = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${roundNumber(v, 2, digits)}`;
            const { rows } = parseTable(html);
            const byLabel = new Map(rows.slice(1).map((r) => [r[0], r[1]]));
            expect(byLabel.get('Success Rate')).toBe(`${fmt(m.success * 100)}%`);
            expect(byLabel.get('Explosive Play Rate')).toBe(`${fmt(m.explosive * 100)}%`);
            expect(byLabel.get('Explosiveness (EPA/success)')).toBe(fmt(m.explosive_epa, 2));
            expect(byLabel.get('Opportunity Conversion Rate')).toBe(`${fmt(m.opp_conversion * 100)}%`);
            expect(byLabel.get('Points per opportunity')).toBe(fmt(m.pts_per_opp));
            expect(byLabel.get('Field position (EP)')).toBe(fmt(m.field_position, 2));
            expect(byLabel.get('Havoc Rate')).toBe(`${fmt(m.havoc * 100)}%`);
            expect(byLabel.get('Turnovers')).toBe(fmt(m.turnovers, 0));
            // the meter: the home share, clamped to 1..99, and the away side its complement
            const homePct = Math.min(99, Math.max(1, Math.round(g.paperIndex.homeShare * 100)));
            expect(html).toContain(`aria-valuenow="${homePct}"`);
            expect(numbers(html.slice(html.indexOf('role="meter"') - 400, html.indexOf('role="meter"')))).toContain(String(100 - homePct));
        }, 30_000);
    });
}

describe('twin inventory: which sections each twin renders', () => {
    test('the classic twin omits BinionBoxScore for the NFL, the v2 twin renders it for both', async () => {
        // A real difference between the twins, pinned so a promotion decision is
        // taken deliberately: classic gates the Binion box on `league == "cfb"`,
        // the v2 SituationalSection always renders it and passes the league
        // through for the percentile pool copy.
        const classic = (await import('../src/components/game/classic/GamePage.astro')).default;
        const src = (await import('node:fs')).readFileSync(new URL('../src/components/game/classic/GamePage.astro', import.meta.url)).toString();
        expect(classic).toBeTruthy();
        expect(src).toMatch(/league == "cfb"\)\s*&&\s*\(<BinionBoxScore/);
        const v2 = (await import('node:fs')).readFileSync(new URL('../src/components/game/metrics/SituationalSection.svelte', import.meta.url)).toString();
        expect(v2).toContain('<BinionBoxScore season={season}');
        expect(v2).not.toContain('league == "cfb"');
    });

    test('TraditionalTeamStats and PenaltyBreakdown are rendered by neither twin', async () => {
        // Both components are live code with unit tests behind them
        // (test/traditionalStats.test.ts, test/penalties.test.ts) but their only
        // call sites are commented out in SituationalSection.svelte. Pinned so
        // that wiring them back in is a deliberate, reviewed change.
        const fs = await import('node:fs');
        const section = fs.readFileSync(new URL('../src/components/game/metrics/SituationalSection.svelte', import.meta.url)).toString();
        expect(section).toContain('<!-- <TraditionalTeamStats');
        for (const tree of ['../src/components/game/GamePage.astro', '../src/components/game/classic/GamePage.astro']) {
            const src = fs.readFileSync(new URL(tree, import.meta.url)).toString();
            expect(src).not.toContain('TraditionalTeamStats');
            expect(src).not.toContain('PenaltyBreakdown');
        }
    });
});
