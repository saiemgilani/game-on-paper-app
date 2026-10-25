import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildPlayIndex } from '../src/utils/playFilterIndex';

const game = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString());
const plays = game.plays as any[];
const [away, home] = game.advBoxScore.team.map((t: any) => t.pos_team);

describe('buildPlayIndex', () => {
    const ix = buildPlayIndex(plays);

    test('finds every player the play text attributes something to', () => {
        // 30 in this game -- the exact count of distinct ids across all 14 role columns.
        // It is not larger because 2024 text names almost no defenders: one sack, no
        // breakups, no forced fumbles. A 2025 game indexes far more.
        const ids = new Set<string>();
        for (const f of ['passer_player_id', 'rusher_player_id', 'receiver_player_id', 'sack_player_id',
            'interception_player_id', 'pass_breakup_player_id', 'fumble_forced_player_id',
            'fumble_recovered_player_id', 'fumble_player_id', 'punter_player_id', 'fg_kicker_player_id',
            'kickoff_player_id', 'kickoff_return_player_id', 'punt_return_player_id']) {
            for (const p of plays) if (p[f] !== null && p[f] !== undefined && p[f] !== '') ids.add(String(p[f]));
        }
        expect(ix.players.length).toBe(ids.size);
        expect(ix.players[0].total).toBeGreaterThan(ix.players[ix.players.length - 1].total);
    });

    test('a passer selector picks out exactly that passer’s dropbacks', () => {
        const qb = ix.players.find((p) => p.roles.pass && p.roles.pass > 20)!;
        expect(qb).toBeTruthy();
        const sel = `r:pass:${qb.id}`;
        const hit = Object.values(ix.byPlay).filter((s) => s.includes(sel)).length;
        expect(hit).toBe(qb.roles.pass);
        // and those are the same plays the raw column identifies
        expect(hit).toBe(plays.filter((p) => String(p.passer_player_id) === qb.id).length);
    });

    test('a defender is credited to the team without the ball', () => {
        const sacker = ix.players.find((p) => p.roles.sack)!;
        const one = plays.find((p) => String(p.sack_player_id) === sacker.id)!;
        expect(sacker.teamId).toBe(String(one.def_pos_team));
        expect(sacker.teamId).not.toBe(String(one.pos_team));
    });

    test('scoping to a team offers only that team’s players', () => {
        const a = buildPlayIndex(plays, away);
        expect(a.players.length).toBeGreaterThan(10);
        expect(a.players.every((p) => p.teamId === String(away))).toBe(true);
        const h = buildPlayIndex(plays, home);
        expect(new Set(a.players.map((p) => p.id)).size + h.players.length)
            .toBeGreaterThanOrEqual(a.players.length);
    });

    test('play tags match a direct count of the plays', () => {
        const count = (sel: string) => Object.values(ix.byPlay).filter((s) => s.includes(sel)).length;
        expect(count('t:penalty')).toBe(plays.filter((p) => p.penalty_flag === true).length);
        expect(count('t:thirdDown')).toBe(plays.filter((p) => Number(p.down) === 3).length);
        expect(count('t:explosive')).toBe(plays.filter((p) => p.EPA_explosive === true).length);
        expect(ix.tagCounts.penalty).toBe(count('t:penalty'));
    });

    test('a play with nobody and no tag is NOT left out of the index', () => {
        const keyed = Object.keys(ix.byPlay).length;
        expect(keyed).toBeGreaterThan(0);
        expect(keyed).toBe(plays.length);
    });

    test('plays with no player ids still index their play types', () => {
        // An early-season game can carry no player ids at all. The tags are still
        // worth offering, which is why the control renders on either half alone.
        const stripped = plays.map((p) => {
            const q: any = { ...p };
            for (const k of Object.keys(q)) if (/_player_id$/.test(k)) q[k] = null;
            return q;
        });
        const ix2 = buildPlayIndex(stripped);
        expect(ix2.players).toEqual([]);
        expect(ix2.tagCounts.penalty).toBe(plays.filter((p) => p.penalty_flag === true).length);
        expect(Object.keys(ix2.byPlay).length).toBeGreaterThan(0);
    });

    test('an empty game indexes to nothing rather than throwing', () => {
        const e = buildPlayIndex([]);
        expect(e.players).toEqual([]);
        expect(Object.keys(e.byPlay)).toEqual([]);
    });
});

describe.each(['game-401729745.json.gz', 'game-401752696.json.gz'])('player teams in %s', (file) => {
    const g = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${file}`, import.meta.url))).toString());
    // the box score's rosters are the independent truth for who plays for whom
    const roster = new Map<string, string>();
    for (const t of g.boxscore.players) for (const s of t.statistics) for (const a of s.athletes) roster.set(String(a.athlete.id), String(t.team.id));
    const ix = buildPlayIndex(g.plays);

    test('every player is grouped under the team his box score lists him on', () => {
        // a kickoff's pos_team is the receiving team and a punt return's the kicking
        // team, so the kickers and returners are the ones a pos_team rule misfiles
        const known = ix.players.filter((p) => roster.has(p.id));
        expect(known.some((p) => p.roles.kickoff || p.roles.pret)).toBe(true);
        expect(known.filter((p) => p.teamId !== roster.get(p.id)).map((p) => p.name)).toEqual([]);
    });

    test('field goals count attempts only, not the kickoffs the kicker column also carries', () => {
        const fg = ix.players.reduce((n, p) => n + (p.roles.fg ?? 0), 0);
        expect(fg).toBe(g.plays.filter((p: any) => p.fg_attempt === true && p.fg_kicker_player_id).length);
    });
});
