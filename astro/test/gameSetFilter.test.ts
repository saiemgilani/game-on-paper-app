import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import type { SDVTeamOpponentSplit } from '../src/resources/sdv';
import { applyGameSet, gameSetLine, gameSetOf, gameSetTable, seasonTeams, type GameSet } from '../src/utils/gameSet';

// The Data API's real 2025 bodies (fixtures/team-game-sets-{cfb,nfl}-2025.json.gz):
// the season-wide team_opponent_splits read and the team_summaries membership read
// the Team Stats panel makes. Alabama (cfb 333) has an FCS opponent (Eastern
// Illinois, 2197), a neutral-site SEC title game and two CFP games, one of them
// against an SEC member (Oklahoma, 201).
const load = (league: 'cfb' | 'nfl') => {
    const f = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/team-game-sets-${league}-2025.json.gz`, import.meta.url))).toString());
    return { season: f.splits.data as SDVTeamOpponentSplit[], teams: seasonTeams(f.summaries.data) };
};
const cfb = load('cfb');
const nfl = load('nfl');
const rowsOf = (season: SDVTeamOpponentSplit[], id: number) => season.filter((r) => r.team_id === id);
const bama = rowsOf(cfb.season, 333);
const ids = (rows: SDVTeamOpponentSplit[]) => rows.map((r) => r.game_id).sort();
const cut = (set: GameSet) => applyGameSet(bama, set, cfb.teams);

describe('derivations from the live F7 columns', () => {
    test('rates are play-weighted sums (Σepa / Σplays, Σsuccesses / Σplays), never a mean of game rates', () => {
        const line = gameSetLine(bama);
        const plays = bama.reduce((s, r) => s + r.plays!, 0);
        expect(line.games).toBe(15);
        expect(line.epa_per_play).toBeCloseTo(bama.reduce((s, r) => s + r.epa_per_play! * r.plays!, 0) / plays, 12);
        expect(line.success_rate).toBeCloseTo(bama.reduce((s, r) => s + r.success_rate! * r.plays!, 0) / plays, 12);
        const meanOfRates = bama.reduce((s, r) => s + r.epa_per_play!, 0) / bama.length;
        expect(line.epa_per_play).not.toBeCloseTo(meanOfRates, 4);
        // points are per game
        expect(line.points_for).toBeCloseTo(bama.reduce((s, r) => s + r.points_for!, 0) / 15, 12);
    });

    test('wins and losses come from the points: Alabama 2025 is 11-4', () => {
        expect(cut('wins')).toHaveLength(11);
        expect(cut('losses')).toHaveLength(4);
        expect(cut('wins').every((r) => r.points_for! > r.points_against!)).toBe(true);
        expect(ids([...cut('wins'), ...cut('losses')])).toEqual(ids(bama));
    });

    test('conference games: regular-season games against a member of the same conference', () => {
        // eight SEC regular-season games plus the SEC title game (ESPN does not flag
        // that one as a conference game); the CFP game against Oklahoma, an SEC member, is out
        expect(ids(cut('conf'))).toEqual(['401752718', '401752726', '401752734', '401752738', '401752751', '401752759', '401752765', '401752784', '401777351'].map(Number));
        expect(cut('conf').every((r) => r.season_type === 2)).toBe(true);
        const cfp = bama.find((r) => r.game_id === 401779840)!;
        expect([cfp.season_type, cfb.teams.get('201')]).toEqual([3, 'SEC']);
        expect(cut('conf')).not.toContain(cfp);
    });

    test('an independent has no conference games, even against another independent', () => {
        const nd = rowsOf(cfb.season, 87);
        expect(cfb.teams.get('87')).toBe('FBS Independents');
        expect(applyGameSet(nd, 'conf', cfb.teams)).toEqual([]);
    });

    test('vs FBS drops exactly the opponents outside the season\'s FBS membership', () => {
        expect(cfb.teams.has('2197')).toBe(false);
        expect(ids(bama).filter((id) => !ids(cut('nofcs')).includes(id))).toEqual([401752773]);
    });

    test('home and away follow is_home: the neutral-site title game is a home game, the Rose Bowl an away one', () => {
        expect(cut('home').length + cut('away').length).toBe(15);
        expect(cut('home').map((r) => r.game_id)).toContain(401777351);
        expect(cut('away').map((r) => r.game_id)).toContain(401769072);
    });

    test('last 4 is the last four by season type then week: Auburn, the title game and both CFP games', () => {
        expect(ids(cut('last4'))).toEqual([401752784, 401769072, 401777351, 401779840]);
    });

    test('an unknown set, or one the league does not offer, is all', () => {
        expect(gameSetOf('bogus', 'cfb')).toBe('all');
        expect(gameSetOf(null, 'cfb')).toBe('all');
        expect(gameSetOf('nofcs', 'nfl')).toBe('all');
        expect(gameSetOf('nofcs', 'cfb')).toBe('nofcs');
        expect(applyGameSet(bama, 'all', cfb.teams)).toBe(bama);
    });
});

describe('gameSetTable: the base team count follows the subset', () => {
    test('every FBS team for a national set (136 in 2025), the conference for conference games', () => {
        const all = gameSetTable(cfb.season, cfb.teams, '333', 'all', 'cfb');
        expect([all.ranked, all.pool]).toEqual([136, 'FBS']);
        const conf = gameSetTable(cfb.season, cfb.teams, '333', 'conf', 'cfb');
        expect([conf.ranked, conf.pool]).toEqual([16, 'SEC']);
        expect(conf.line).toEqual(gameSetLine(cut('conf')));
    });

    test('32 NFL teams, or the 16 of the team\'s conference', () => {
        expect(nfl.teams.get('12')).toBe('AFC');
        const all = gameSetTable(nfl.season, nfl.teams, '12', 'all', 'nfl');
        expect([all.ranked, all.pool]).toEqual([32, 'NFL']);
        const conf = gameSetTable(nfl.season, nfl.teams, '12', 'conf', 'nfl');
        expect([conf.ranked, conf.pool]).toEqual([16, 'AFC']);
        expect(conf.line.games).toBe(rowsOf(nfl.season, 12).filter((r) => nfl.teams.get(String(r.opponent_id)) === 'AFC').length);
        expect(all.sets).not.toContain('nofcs');
    });

    test('ranks: competition rank, highest first, except points against (fewest first)', () => {
        const lines = [...cfb.teams.keys()].map((id) => [id, gameSetLine(rowsOf(cfb.season, Number(id)))] as const);
        const best = (key: 'epa_per_play' | 'points_against', low: boolean) =>
            lines.toSorted(([, a], [, b]) => (low ? a[key]! - b[key]! : b[key]! - a[key]!))[0][0];
        expect(gameSetTable(cfb.season, cfb.teams, best('epa_per_play', false), 'all', 'cfb').ranks.epa_per_play).toBe(1);
        expect(gameSetTable(cfb.season, cfb.teams, best('points_against', true), 'all', 'cfb').ranks.points_against).toBe(1);
        const t = gameSetTable(cfb.season, cfb.teams, '333', 'all', 'cfb');
        const own = gameSetLine(bama).epa_per_play!;
        expect(t.ranks.epa_per_play).toBe(1 + lines.filter(([, l]) => l.epa_per_play! > own).length);
    });

    test('a set the team has no game in is not offered, and asking for it renders all', () => {
        const nd = gameSetTable(cfb.season, cfb.teams, '87', 'conf', 'cfb');
        expect(nd.sets).not.toContain('conf');
        expect(nd.set).toBe('all');
        expect(gameSetTable(cfb.season, cfb.teams, '333', 'conf', 'cfb').sets)
            .toEqual(['all', 'conf', 'nofcs', 'home', 'away', 'wins', 'losses', 'last4']);
    });

    test('a team outside the FBS has its line but no rank', () => {
        const eiu = gameSetTable(cfb.season, cfb.teams, '2197', 'all', 'cfb');
        expect(eiu.line.games).toBeGreaterThan(0);
        expect(Object.values(eiu.ranks)).toEqual([null, null, null, null]);
    });
});
