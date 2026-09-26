import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// Mirror of gamePage.render.test.ts for the NFL: a REAL ProcessedGame from
// /nfl/401772944/process (LV @ DEN, 2025 REG week 10, final) through the
// shared component tree with locals.league = 'nfl'. Proves (a) the NFL record
// shape renders the CFB components, (b) every internal link carries the /nfl
// prefix, (c) no college-football ESPN URL leaks into an NFL page.
const GAME_ID = 401772944;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401772944-nfl.json.gz', import.meta.url))).toString();
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (!String(url).includes(`/nfl/${GAME_ID}/process`)) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(apiPayload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

describe('GamePage renders a finished NFL game end to end', () => {
    let html = '';
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30, 'nfl');
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        // these v2 renders assert the public header; game-links (flag on) is covered by gameHeaderLinks.render.test.ts
        html = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game, league: 'nfl' },
            request: new Request(`https://gameonpaper.com/nfl/game/${GAME_ID}`),
            locals: { league: 'nfl', preview: true, flagOverrides: { 'game-links': false } },
        });
        if (process.env.DUMP_HTML) writeFileSync(process.env.DUMP_HTML, html);
    }, 60_000);

    test('the whole document arrives, not an empty stream', () => {
        expect(html.length).toBeGreaterThan(100_000);
        expect(html).toContain('</html>');
    });

    test('both teams and the section anchors are present', () => {
        expect(html).toContain('Raiders');
        expect(html).toContain('Broncos');
        for (const anchor of ['#drives', '#all-plays']) expect(html).toContain(`href="${anchor}"`);
    });

    test('internal links carry the /nfl prefix and no cfb link leaks', () => {
        // the matchup preview reads the season tables (on the API since the
        // 2002-2025 rollout), so it is offered -- prefixed like everything else
        expect(html).toContain('href="/nfl/game/matchup?');
        expect(html).not.toMatch(/href="\/game\/matchup\?/);
        expect(html).toContain(`href="https://gameonpaper.com/nfl/game/${GAME_ID}"`);
        expect(html).not.toMatch(/href="\/game\/\d+/);
        expect(html).not.toMatch(/href="\/year\/\d{4}\/team\//);
        expect(html).toMatch(/href="\/nfl\/year\/\d{4}\/team\//);
    });

    test('ESPN URLs are the NFL ones', () => {
        expect(html).toContain(`https://www.espn.com/nfl/game/_/gameId/${GAME_ID}`);
        expect(html).toContain(`sports/football/nfl/events/${GAME_ID}.png`);
        // team logos: the shared components used to hard-code the NCAA path
        expect(html).toContain('teamlogos/nfl/500/7.png');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).toContain(`https://gameonpaper.com/nfl/game/${GAME_ID}`); // canonical
        // glossary rows may cite college-football writing (Football Study Hall,
        // The Athletic); what must not appear is an ESPN college-football URL
        expect(html).not.toMatch(/espn\.com\/college-football|football\/college-football\/events/);
    });

    test('the back-to-scoreboard links stay in the league', () => {
        expect(html).toContain('href="/nfl"');
        expect(html).not.toMatch(/href="\/"><i class="bi-arrow-left"/);
        expect(html).not.toContain('/teams/differential');
    });
});

describe('the NFL game page carries the same v2 blocks as the CFB page (#243 alignment)', () => {
    test('Deserved Win % renders for an NFL game once the processor emits paperIndex', async () => {
        // the committed fixture predates sportsdataverse-py #488, which made the
        // NFL processor emit paperIndex; inject the shape it now returns
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game: any = await retrieveProcessedGame(GAME_ID, 30, 'nfl');
        game.paperIndex = {
            homeShare: 0.62,
            margins: { success: 0.08, explosive: -0.01, explosive_epa: 0.12, opp_conversion: 0.2, pts_per_opp: 0.5, field_position: 0.1, havoc: 0.02, turnovers: 1 },
            byPeriod: { q1: { homeShare: 0.55, margins: {} } },
        };
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        const html = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game, league: 'nfl' },
            request: new Request(`https://gameonpaper.com/nfl/game/${GAME_ID}`),
            locals: { league: 'nfl', preview: true, flagOverrides: { 'game-links': false } },
        });
        expect(html).toContain('href="#paper-index-panel"');
        expect(html).toContain('Deserved Win %');
        // the panel's team logos follow the league like every other block
        expect(html).toContain('teamlogos/nfl/500/');
        expect(html).not.toContain('teamlogos/ncaa/');
    }, 60_000);

});


describe('usage / situational / special-teams sections', () => {
    test('render once the processor emits the usage box, and stay absent otherwise', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        const render = async (game: any) => container.renderToString(GamePage, {
            props: { id: GAME_ID, game, league: 'nfl' },
            request: new Request(`https://gameonpaper.com/nfl/game/${GAME_ID}`),
            locals: { league: 'nfl', preview: true, flagOverrides: { 'game-links': false } },
        });
        const bare = await retrieveProcessedGame(GAME_ID, 30, 'nfl');
        const without = await render(bare);
        expect(without).not.toContain('id="situational-splits-panel"');

        const game = await retrieveProcessedGame(GAME_ID, 30, 'nfl');
        const away = parseInt(game.teamInfo.away.id);
        const home = parseInt(game.teamInfo.home.id);
        const usage = (team: number, name: string, id: string) => ({
            pos_team: team, player_id: id, player_name: name, position_group: 'WR',
            rushes: 0, targets: 9, receptions: 6, touches: 6, opportunities: 9, rush_yards: 0, receiving_yards: 88,
            first_downs: 4, touchdowns: 1, fd_or_td: 4, explosive_plays: 2, successful_plays: 5, epa: 4.2,
            rz_rushes: 0, rz_targets: 2, rz_touches: 1, rz_touchdowns: 1, so_rushes: 0, so_targets: 3, so_touches: 2, so_touchdowns: 1,
            third_down_opportunities: 3, third_down_conversions: 2, third_down_expected: 1.4,
            fd_td_rate: 4 / 9, explosive_rate: 2 / 9, success_rate: 5 / 9, epa_per_opportunity: 4.2 / 9,
            rz_touchdown_rate: 1, so_touchdown_rate: 0.5, third_down_rate: 2 / 3, third_down_over_expected: 0.6,
            target_share: 0.3, first_down_share: 0.2, touch_share: 0.1,
        });
        game.advBoxScore.player_usage = [
            usage(away, 'Away Receiver', 'a1'), usage(home, 'Home Receiver', 'h1'),
            // processor data is never markup: an unexpected group value must render escaped
            { ...usage(home, 'Odd Group', 'h2'), position_group: '<b>evil</b>' },
        ];
        game.advBoxScore.tackles = [
            { def_pos_team: away, player_id: 'd1', player_name: 'Away Backer', position_group: 'LB', tackles: 7, assists: 2, tackle_points: 8, team_tackle_points: 8, tackle_share: 1 },
        ];
        game.advBoxScore.team_usage = [away, home].map((team) => ({
            pos_team: team, plays: 60, rushes: 25, targets: 35, completions: 22, first_downs: 18, touchdowns: 3, explosive_plays: 6, successful_plays: 27, epa: 5.5,
            third_down_opportunities: 12, third_down_conversions: 5, third_down_expected: 4.6, third_down_rate: 5 / 12, third_down_over_expected: 0.4,
            success_rate: 0.45, explosive_rate: 0.1, epa_per_play: 0.09,
            rz_plays: 8, rz_successes: 4, rz_epa: 1.1, rz_touchdowns: 2, rz_targets: 4, rz_rushes: 4, rz_trips: 3, rz_points: 17, rz_touchdown_rate: 2 / 3, rz_points_per_trip: 17 / 3, rz_success_rate: 0.5, rz_epa_per_play: 0.14,
            so_plays: 14, so_successes: 7, so_epa: 2.0, so_touchdowns: 3, so_targets: 7, so_rushes: 7, so_trips: 5, so_points: 24, so_touchdown_rate: 0.6, so_points_per_trip: 4.8, so_success_rate: 0.5, so_epa_per_play: 0.14,
        }));
        game.advBoxScore.drive_scripting = [away, home].flatMap((team) => [
            { pos_team: team, script: 'scripted', drives: 4, plays: 24, epa: 3, successes: 12, yards: 160, points: 10, touchdowns: 1, scoring_opps: 3, epa_per_play: 0.125, success_rate: 0.5, yards_per_play: 6.7, points_per_drive: 2.5, touchdown_rate: 0.25, scoring_opp_rate: 0.75 },
            { pos_team: team, script: 'non_scripted', drives: 8, plays: 40, epa: 1, successes: 16, yards: 200, points: 14, touchdowns: 2, scoring_opps: 4, epa_per_play: 0.025, success_rate: 0.4, yards_per_play: 5, points_per_drive: 1.75, touchdown_rate: 0.25, scoring_opp_rate: 0.5 },
        ]);
        game.advBoxScore.st_kickers = [{
            pos_team: home, player_id: 'k1', player_name: 'Home Kicker', kickoffs: 5, kickoff_yards: 320, kickoff_touchbacks: 3, kickoff_onside: 0, kickoff_out_of_bounds: 0,
            kickoff_returns_allowed: 2, kickoff_return_yards_allowed: 44, kickoff_return_tds_allowed: 0, kickoff_epa: 0.3, fg_attempts: 3, fg_made: 2, fg_long: 48, fg_blocked: 0,
            fg_0_39_attempts: 1, fg_0_39_made: 1, fg_40_49_attempts: 2, fg_40_49_made: 1, fg_50_plus_attempts: 0, fg_50_plus_made: 0, fg_epa: 1.1, xp_attempts: 2, xp_made: 2,
            kickoff_avg: 64, kickoff_touchback_rate: 0.6, kickoff_return_avg_allowed: 22, fg_pct: 2 / 3, xp_pct: 1,
        }];
        game.advBoxScore.st_punters = [{
            pos_team: away, player_id: 'p1', player_name: 'Away Punter', punts: 4, punt_yards: 180, punt_long: 55, punt_touchbacks: 1, punt_inside_20: 2, punt_fair_catches: 1, punt_downed: 1,
            punt_out_of_bounds: 0, punt_blocked: 0, punt_returns_allowed: 1, punt_return_yards_allowed: 8, punt_return_tds_allowed: 0, punt_epa: -0.4, punt_avg: 45, punt_net_yards: 152, punt_net_avg: 38, punt_inside_20_rate: 0.5, punt_return_avg_allowed: 8,
        }];
        game.advBoxScore.position_group_usage = [{ ...usage(home, '', ''), player_id: undefined, player_name: undefined, position_group: 'TE', opportunities: 12 }];
        game.advBoxScore.position_group_tackles = [
            { def_pos_team: away, position_group: 'DB', tackles: 11, assists: 4, tackle_points: 13, team_tackle_points: 21, tackle_share: 13 / 21 },
        ];
        game.advBoxScore.st_returners = [{
            pos_team: home, player_id: 'r1', player_name: 'Home Returner', kick_returns: 2, kick_return_yards: 50, kick_return_long: 31, kick_return_tds: 0, kick_return_epa: 0.4,
            punt_returns: 1, punt_return_yards: 12, punt_return_long: 12, punt_return_tds: 1, punt_return_epa: 3.1, kick_return_avg: 25, punt_return_avg: 12,
        }];
        game.advBoxScore.st_blocks = [{ def_pos_team: away, player_id: 'b1', player_name: 'Away Blocker', punt_blocks: 1, fg_blocks: 0, blocks: 1 }];
        game.advBoxScore.st_team = [away, home].map((team) => ({
            pos_team: team, kickoffs: 5, kickoff_touchbacks: 3, kickoff_returns_allowed: 2, kickoff_return_yards_allowed: 44, kickoff_return_tds_allowed: 0, kickoff_epa: 0.3,
            kick_returns: 2, kick_return_yards: 50, kick_return_tds: 0, kick_return_epa: 0.2, punts: 4, punt_yards: 180, punt_touchbacks: 1, punts_blocked: 0, punt_returns_allowed: 1,
            punt_return_yards_allowed: 8, punt_return_tds_allowed: 0, punt_epa: -0.4, punt_returns: 1, punt_return_yards: 12, punt_return_tds: 0, punt_return_epa: 0.1,
            // no punt_blocks_by / fg_blocks_by: the processor omits them when no kick was blocked
            fg_attempts: 3, fg_made: 2, fgs_blocked: 0, fg_epa: 1.1, punt_net_yards: 152, kickoff_touchback_rate: 0.6, kickoff_return_avg_allowed: 22,
            punt_net_avg: 38, punt_return_avg_allowed: 8, kick_return_avg: 25, punt_return_avg: 12, fg_pct: 2 / 3,
        }));
        const html = await render(game);
        expect(html).toContain('id="situational-splits-panel"');
        expect(html).toContain('3rd downs over expected');
        expect(html).toContain('Scripted drives');
        expect(html).toContain('Net punt average');
        expect(html).toContain('0 punt, 0 FG');
        expect(html).not.toContain('undefined punt');
        // the processor attaches the usage sections to every span box too, but
        // only the full-game box renders them: they must not reach the island props
        // a fresh window object: the fixture's `all` span aliases advBoxScore itself
        (game.advBoxScoreSpans as any).q1 = { ...game.advBoxScoreSpans.all, player_usage: [usage(away, 'Span Only Receiver', 's1')] };
        const withSpans = await render(game);
        expect(withSpans).toContain('Away Receiver');
        expect(withSpans).not.toContain('Span Only Receiver');
        expect(withSpans).not.toContain('player_usage');
        expect(html).toContain('Away Receiver');
        expect(html).toContain('Home Receiver');
        expect(html).toContain('Away Backer');
        expect(html).toContain('Home Kicker');
        expect(html).toContain('Away Punter');
        expect(html).toContain('FG 2/3');
        // returner, block and position-group rows
        expect(html).toContain('Home Returner');
        expect(html).toContain('KR 2-50, 25.0 avg, 31 LNG.');
        expect(html).toContain('PR 1-12, 12.0 avg, 12 LNG, 1 TD.');
        expect(html).toContain('Away Blocker');
        expect(html).toContain('1 punt blocked.');
        expect(html).toContain('<i>TE</i>');
        expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
        expect(html).not.toContain('<b>evil</b>');
        expect(html).toContain('<i>DB</i>');
    }, 120_000);
});
