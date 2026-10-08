import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';

// Game Excitement Index: sum of |delta home WP| across plays, scaled per play.
// The last play has no next play, so its "next" home WP is the result: 1 if
// home won, 0 if away won, 0.5 for a tie -- whoever has the ball. It used to
// key on possession, so a game whose final snap was the AWAY team's (a trailing
// team's last heave, or a winner kneeling it out on the road) closed with a
// spurious ~1.0 swing.

const payload = (file: string) => gunzipSync(readFileSync(new URL(`./fixtures/${file}`, import.meta.url))).toString();

// A real NFL final (DEN 10, LV 7) re-scored 10-10 on its last play: no NFL tie
// fixture exists, and the tie path only reads the last play's two scores.
const tie = JSON.parse(payload('game-401772944-nfl.json.gz'));
Object.assign(tie.plays.at(-1), { awayScore: tie.plays.at(-1).homeScore });

const bodies: Record<string, string> = {
    '/cfb/401729745/process': payload('game-401729745.json.gz'),
    '/nfl/401772944/process': payload('game-401772944-nfl.json.gz'),
    '/cfb/401752696/process': payload('game-401752696.json.gz'),
    '/nfl/401772944-tie/process': JSON.stringify(tie),
};

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const key = Object.keys(bodies).find((k) => String(url).includes(k));
        if (!key) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(bodies[key], { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

// The oracle, written from the definition rather than copied from python.ts.
function expectedGEI(game: any): number {
    const home = Number(game.teamInfo.home.id);
    const homeWP = (p: any) => (Number(p.pos_team) === home ? p.winProbability.before : 1 - p.winProbability.before);
    const last = game.plays.at(-1);
    const result = last.homeScore > last.awayScore ? 1 : last.homeScore < last.awayScore ? 0 : 0.5;
    let sum = 0;
    game.plays.forEach((p: any, i: number) => {
        const next = i + 1 < game.plays.length ? homeWP(game.plays[i + 1]) : result;
        sum += Math.abs(next - homeWP(p));
    });
    return (179.01777401608126 / game.plays.length) * sum;
}

async function gei(league: 'cfb' | 'nfl', id: string) {
    const { retrieveProcessedGame } = await import('../src/resources/python');
    const raw = JSON.parse(bodies[`/${league}/${id}/process`]);
    const game = await retrieveProcessedGame(id, 30, league);
    const last = raw.plays.at(-1);
    return { gei: game.gei!, expected: expectedGEI(raw), last, home: raw.teamInfo.home.id, away: raw.teamInfo.away.id };
}

describe('GEI closes on the result, not on who has the ball', () => {
    test('losing team (away) has the last snap: Wisconsin at Alabama, 14-38', async () => {
        const g = await gei('cfb', '401752696');
        expect(String(g.last.pos_team)).toBe(String(g.away));
        expect(g.last.homeScore).toBeGreaterThan(g.last.awayScore);
        expect(g.gei).toBeCloseTo(g.expected, 10);
        expect(g.gei.toFixed(2)).toBe('0.79'); // was 2.15 with the possession rule
    });

    test('winning team (home) has the last snap: NDSU kneels out a 51-31 win', async () => {
        const g = await gei('cfb', '401729745');
        expect(String(g.last.pos_team)).toBe(String(g.home));
        expect(g.last.homeScore).toBeGreaterThan(g.last.awayScore);
        expect(g.gei).toBeCloseTo(g.expected, 10);
    });

    test('winning team (home) has the last snap: Denver kneels out a 10-7 win', async () => {
        const g = await gei('nfl', '401772944');
        expect(String(g.last.pos_team)).toBe(String(g.home));
        expect(g.gei).toBeCloseTo(g.expected, 10);
    });

    test('a tie closes at 0.5', async () => {
        const g = await gei('nfl', '401772944-tie');
        expect(g.last.homeScore).toBe(g.last.awayScore);
        expect(g.gei).toBeCloseTo(g.expected, 10);
    });
});
