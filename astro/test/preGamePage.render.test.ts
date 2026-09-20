import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// PreGamePage, both leagues, from real ESPN pregame payloads. The NFL game page
// test next door uses a FINAL game, so PreGamePage never rendered in the suite
// and every college-football default on it (the summary endpoint, the NCAA logo
// path, the 134-team colour ramp) shipped unnoticed on /nfl.
const FIXTURES = {
    nfl: { id: 401872933, file: 'pregame-401872933-nfl.json.gz', home: '1', away: '29' },   // CAR @ ATL, 2026 week 3
    cfb: { id: 401858458, file: 'pregame-401858458-cfb.json.gz', home: '26', away: '2509' }, // PUR @ UCLA, 2026 week 4
} as const;

const payloads = Object.fromEntries(Object.entries(FIXTURES).map(([league, f]) => [
    league,
    JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${f.file}`, import.meta.url))).toString()),
])) as Record<string, { playbyplay: any; summary: any }>;

// every rank is 24th: on the league's own scale that is hulk-bg-level-3 for the
// NFL (24/32) and hulk-bg-level-8 for cfb (24/134) -- the ramp bug in one class name
const RANK = 24;
const summaryRow = (teamId: string) => {
    const row: Record<string, any> = { team_id: Number(teamId), pos_team: `Team ${teamId}`, season: 2025, net_adj_epa: 0.11, adj_off_epa: 0.2, adj_def_epa: -0.09 };
    for (const k of ['net_adj_epa', 'EPAplay_margin', 'yardsplay_margin', 'available_yards_pct_margin', 'success_margin']) {
        row[k] = row[k] ?? 0.05;
        row[`${k}_rank`] = RANK;
    }
    return row;
};

// Real ATL/CAR rows from nfl.espn_schedule: two completed 2025 meetings (division
// rivals play twice) and a SCHEDULED 2026 one. The schedule table carries the
// whole season, so the unplayed game is what leaked into "Previous Meetings".
const MATCHUP_ROWS = [
    { game_id: 401772838, season: 2025, week: 3, season_type: 'regular', start_date: '2025-09-21T17:00:00.000Z', completed: true,
      away_id: 1, away_team: 'Atlanta Falcons', away_abbreviation: 'ATL', away_points: 0,
      home_id: 29, home_team: 'Carolina Panthers', home_abbreviation: 'CAR', home_points: 30 },
    { game_id: 401772882, season: 2025, week: 11, season_type: 'regular', start_date: '2025-11-16T18:00:00.000Z', completed: true,
      away_id: 29, away_team: 'Carolina Panthers', away_abbreviation: 'CAR', away_points: 30,
      home_id: 1, home_team: 'Atlanta Falcons', home_abbreviation: 'ATL', home_points: 27 },
    { game_id: 401873172, season: 2026, week: 18, season_type: 'regular', start_date: '2027-01-10T18:00:00.000Z', completed: false,
      away_id: 1, away_team: 'Atlanta Falcons', away_abbreviation: 'ATL', away_points: null,
      home_id: 29, home_team: 'Carolina Panthers', home_abbreviation: 'CAR', home_points: null },
];

const NAME_KEY: Record<string, string> = { passing: 'passer_player_name', rushing: 'rusher_player_name', receiving: 'receiver_player_name' };
const playerRow = (table: string, teamId: string) => ({
    [NAME_KEY[table]]: `${table} leader ${teamId}`, player_id: `${table}-${teamId}`, team_id: Number(teamId),
    TEPA: 30, EPAplay: 0.25, plays: 120, yards: 900, comppct: 0.66, passing_td: 8, rushing_td: 6,
});

const fetched: string[] = [];
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const u = String(url);
        fetched.push(u);
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        const summary = u.match(/football\/(college-football|nfl)\/summary\?event=(\d+)/);
        if (summary) {
            const league = summary[1] === 'nfl' ? 'nfl' : 'cfb';
            if (String(FIXTURES[league].id) !== summary[2]) throw new Error(`summary for the wrong league: ${u}`);
            return json(payloads[league].summary);
        }
        const sdv = u.match(/data\.sportsdataverse\.org\/v1\/(cfb|nfl)\/([a-z_]+)\?(.*)$/);
        if (sdv) {
            const [, league, table, query] = sdv;
            const params = new URLSearchParams(query);
            const teamId = params.get('team_id');
            if (table === 'team_summaries' && teamId) return json({ data: [summaryRow(teamId)] });
            if (['passing', 'rushing', 'receiving'].includes(table) && teamId) return json({ data: [playerRow(table, teamId)] });
            // the matchup-history read: both sides pinned, one orientation per call
            const [homeId, awayId] = [params.get('home_id'), params.get('away_id')];
            if (league === 'nfl' && homeId && awayId) {
                return json({ data: MATCHUP_ROWS.filter(g => String(g.home_id) === homeId && String(g.away_id) === awayId) });
            }
            return json({ data: [] });
        }
        throw new Error(`unexpected fetch in test: ${u}`);
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const render = async (league: 'cfb' | 'nfl') => {
    const { id } = FIXTURES[league];
    const { default: PreGamePage } = await import('../src/components/game/PreGamePage.astro');
    const html = await container.renderToString(PreGamePage, {
        props: { id, espnGame: payloads[league].playbyplay, league },
        request: new Request(`https://gameonpaper.com${league === 'nfl' ? '/nfl' : ''}/game/${id}`),
        locals: { league, preview: true },
    });
    if (process.env.DUMP_HTML) writeFileSync(`${process.env.DUMP_HTML}.${league}.html`, html);
    return html;
};

describe('PreGamePage renders a scheduled NFL game as an NFL page', () => {
    let html = '';
    beforeAll(async () => { fetched.length = 0; html = await render('nfl'); }, 60_000);

    test('the whole document arrives with both teams', () => {
        expect(html).toContain('</html>');
        expect(html).toContain('Falcons');
        expect(html).toContain('Panthers');
    });

    test('the ESPN summary is read from the NFL endpoint, so venue and recent form render', () => {
        expect(fetched.some(u => u.includes('football/nfl/summary?event=401872933'))).toBe(true);
        expect(fetched.some(u => u.includes('college-football/summary'))).toBe(false);
        expect(html).toContain('Mercedes-Benz Stadium');   // gameInfo.venue, summary-only
        expect(html).toContain('Recent Form');             // lastFiveGames, summary-only
    });

    test('every team logo is an NFL logo', () => {
        expect(html).toContain('teamlogos/nfl/500/1.png');
        expect(html).toContain('teamlogos/nfl/500/29.png');
        expect(html).not.toContain('teamlogos/ncaa/');
    });

    test('rank cells use the 32-team ramp and links stay in the league', () => {
        expect(html).toContain('hulk-bg-level-3');
        expect(html).not.toContain('hulk-bg-level-8');
        expect(html).toContain('href="/nfl/team/1"');
        expect(html).not.toMatch(/href="\/team\/\d+"/);
    });

    test('the schedule reads the league-configured table', () => {
        expect(fetched.some(u => u.includes('/v1/nfl/espn_schedule?'))).toBe(true);
        expect(fetched.some(u => u.includes('/v1/nfl/schedule?'))).toBe(false);
    });

    test('previous meetings list every completed game and no scheduled one', () => {
        expect(html).toContain('Previous Meetings');
        // both 2025 meetings, whichever side hosted
        expect(html).toContain('href="/nfl/game/401772838"');
        expect(html).toContain('href="/nfl/game/401772882"');
        // the 2026 game has not been played: it is not history
        expect(html).not.toContain('401873172');
    });

    test('the radar island is told which league it is drawing', () => {
        expect(html).toContain('MatchupRadarChart');
        expect(html).toMatch(/league&quot;:\[0,&quot;nfl&quot;\]/);
    });
});

describe('PreGamePage still renders a college game as a college page', () => {
    let html = '';
    beforeAll(async () => { fetched.length = 0; html = await render('cfb'); }, 60_000);

    test('the college-football summary endpoint and the NCAA logos are unchanged', () => {
        expect(fetched.some(u => u.includes('football/college-football/summary?event=401858458'))).toBe(true);
        expect(html).toContain('Rose Bowl');
        expect(html).toContain('teamlogos/ncaa/500/26.png');
        expect(html).toContain('teamlogos/ncaa/500/2509.png');
        expect(html).not.toContain('teamlogos/nfl/500/');
    });

    test('rank cells keep the 134-team ramp and links keep no prefix', () => {
        expect(html).toContain('hulk-bg-level-8');
        expect(html).not.toContain('hulk-bg-level-3');
        expect(html).toContain('href="/team/26"');
        expect(html).not.toContain('href="/nfl/');
    });

    test('the schedule still reads the cfb `schedule` table', () => {
        expect(fetched.some(u => u.includes('/v1/cfb/schedule?'))).toBe(true);
        expect(fetched.some(u => u.includes('espn_schedule'))).toBe(false);
    });
});

describe('radar percentiles scale to the league', () => {
    test('a 24th-place rank is mid-pack in the NFL and near-elite in cfb', async () => {
        const { generateRadarPercentiles } = await import('../src/utils/radar');
        const pct = (league: 'cfb' | 'nfl') => {
            const axis = generateRadarPercentiles({ EPAplay_off_rank: RANK }, 'Offensive', league)
                .find(p => p.title === 'EPA/Play');
            return axis!.percentile;
        };
        expect(pct('nfl')).toBe(25);  // (32 - 24) / 32
        expect(pct('cfb')).toBe(82);  // (134 - 24) / 134
        // the worst team in the league plots at the bottom of the chart, not at 76
        expect(generateRadarPercentiles({ EPAplay_off_rank: 32 }, 'Offensive', 'nfl').find(p => p.title === 'EPA/Play')!.percentile).toBe(0);
    });
});
