import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
    EspnCategory, nameKey, officialDefense, officialKickers, officialPassing, officialPunters, officialReceiving,
    officialReturners, officialRushing, officialTeamBox, pair, type EspnPlayerRow,
} from '../src/utils/officialBox';
import { playerIdsByName } from '../src/utils/usage';

// Real advBoxScore sections (fixtures/README.md): 401856889 ALA@VAN (CFB, 2026-11-14) and
// 401873054 BUF@NYJ (NFL, 2026-11-15), the two worst football games in the 2026-11-19
// box-accuracy audit.
const FX: Record<string, any> = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/official-box-2026.json.gz', import.meta.url))).toString());
const CFB = FX.cfb_401856889, NFL = FX.nfl_401873054;
const VAN = 238, NYJ = 20;

const teamsOf = (box: any) => [...new Set((box.espn_players as EspnPlayerRow[]).map((r) => r.team_id))];
const rowsOf = (box: any, k: string, team: number) => (box[k] as any[]).filter((r) => r.pos_team == team);

describe('every counting stat ESPN publishes is ESPN\'s, never the play-by-play\'s', () => {
    // Walks ESPN's own lines and finds each one in the overlaid output by athlete id, so a
    // single count still taken from pbp where ESPN has a number fails here.
    for (const [label, box] of [['cfb', CFB], ['nfl', NFL]] as const) {
        for (const team of teamsOf(box)) {
            const ids = playerIdsByName(box, team!);
            const espn = box.espn_players as EspnPlayerRow[];
            const of = (cat: string) => espn.filter((r) => r.category === cat && r.team_id === team);
            const byId = (lines: any[], id: unknown) => lines.filter((l) => String(l.espn_athlete_id) === String(id));

            test(`${label} ${team} passing`, () => {
                const out = officialPassing(rowsOf(box, 'pass', team!), espn, team!, ids);
                for (const e of of('passing')) {
                    const [hit, ...dup] = byId(out, e.athlete_id);
                    expect(dup).toHaveLength(0);
                    const [c, a] = pair(e['completions/passingAttempts']);
                    expect([hit.Comp, hit.Att, hit.Yds, hit.Pass_TD, hit.Int]).toEqual([c, a, e.passingYards, e.passingTouchdowns, e.interceptions]);
                    if (label === 'nfl') expect(hit.Sck).toBe(pair(e['sacks-sackYardsLost'])[0]);
                    expect(hit.source).toBe('espn');
                }
            });
            test(`${label} ${team} rushing`, () => {
                const out = officialRushing(rowsOf(box, 'rush', team!), espn, team!, ids);
                for (const e of of('rushing')) {
                    const [hit, ...dup] = byId(out, e.athlete_id);
                    expect(dup).toHaveLength(0);
                    expect([hit.Car, hit.Yds, hit.Rush_TD]).toEqual([e.rushingAttempts, e.rushingYards, e.rushingTouchdowns]);
                }
            });
            test(`${label} ${team} receiving`, () => {
                const out = officialReceiving(rowsOf(box, 'receiver', team!), espn, team!, ids);
                for (const e of of('receiving')) {
                    const [hit, ...dup] = byId(out, e.athlete_id);
                    expect(dup).toHaveLength(0);
                    expect([hit.Rec, hit.Yds, hit.Rec_TD]).toEqual([e.receptions, e.receivingYards, e.receivingTouchdowns]);
                    if (label === 'nfl') expect(hit.Tar).toBe(e.receivingTargets);
                }
            });
            test(`${label} ${team} kicking, punting, returns`, () => {
                const k = officialKickers(rowsOf(box, 'st_kickers', team!), espn, team!);
                for (const e of of('kicking')) {
                    const [hit] = byId(k, e.athlete_id);
                    expect([hit.fg_made, hit.fg_attempts]).toEqual(pair(e['fieldGoalsMade/fieldGoalAttempts']));
                    expect([hit.xp_made, hit.xp_attempts]).toEqual(pair(e['extraPointsMade/extraPointAttempts']));
                }
                const p = officialPunters(rowsOf(box, 'st_punters', team!), espn, team!);
                for (const e of of('punting')) {
                    const [hit] = byId(p, e.athlete_id);
                    expect([hit.punts, hit.punt_avg, hit.punt_long, hit.punt_inside_20]).toEqual([e.punts, e.grossAvgPuntYards, e.longPunt, e.puntsInside20]);
                }
                const r = officialReturners(rowsOf(box, 'st_returners', team!), espn, team!);
                for (const e of of('kickReturns')) {
                    expect(byId(r, e.athlete_id).find((x) => x.kick_returns === e.kickReturns && x.kick_return_yards === e.kickReturnYards)).toBeTruthy();
                }
                for (const e of of('puntReturns')) {
                    expect(r.find((x) => x.punt_returns === e.puntReturns && x.punt_return_yards === e.puntReturnYards && nameKey(x.player_name).split(' ').pop() === nameKey(e.athlete).split(' ').pop())).toBeTruthy();
                }
            });
        }
    }
});

describe('the audit\'s worst lines now read the official book', () => {
    test('CFB: a QB\'s sacks are rushes in the NCAA box (Jared Curtis 9 car, -18, not pbp 4 car, 9)', () => {
        const pbp = rowsOf(CFB, 'rush', VAN).find((r) => r.rusher_player_name === 'Jared Curtis');
        expect([pbp.Car, pbp.Yds]).toEqual([4, 9]);
        const out = officialRushing(rowsOf(CFB, 'rush', VAN), CFB.espn_players, VAN, playerIdsByName(CFB, VAN));
        const line = out.find((r) => r.rusher_player_name === 'Jared Curtis')!;
        expect([line.Car, line.Yds, line.source]).toEqual([9, -18, 'espn']);
        // EPA stays the play-by-play's
        expect(line.EPA).toBe(pbp.EPA);
    });

    test('NFL: an interception booked as a completion (Klubnik 12/20 134 0 INT -> 11/20 137 1 INT)', () => {
        const out = officialPassing(rowsOf(NFL, 'pass', NYJ), NFL.espn_players, NYJ, playerIdsByName(NFL, NYJ));
        const line = out.find((r) => r.passer_player_name === 'Cade Klubnik')!;
        expect([line.Comp, line.Att, line.Yds, line.Int, line.Sck]).toEqual([11, 20, 137, 1, 3]);
    });
});

describe('fallback: never a blank where pbp had a number', () => {
    test('a target ESPN does not list keeps its pbp counts, marked', () => {
        const rows = [...rowsOf(CFB, 'receiver', VAN), { pos_team: VAN, receiver_player_name: 'Not On Espn', Rec: 1, Tar: 2, Yds: 6, Rec_TD: 0, EPA: -0.5 }];
        const out = officialReceiving(rows, CFB.espn_players, VAN, new Map());
        const line = out.find((r) => r.receiver_player_name === 'Not On Espn')!;
        expect([line.Rec, line.Tar, line.Yds, line.source]).toEqual([1, 2, 6, 'pbp']);
    });

    test('a zero-catch target or a kickoff-only kicker agrees with ESPN by omission: unmarked', () => {
        // ESPN lists neither; the real fixture has both (Martel Hight 0 rec; J.Dewers kickoffs only)
        const rec = officialReceiving(rowsOf(CFB, 'receiver', VAN), CFB.espn_players, VAN, new Map());
        const hight = rec.find((r) => r.receiver_player_name === 'Martel Hight')!;
        expect([hight.Rec, hight.source]).toEqual([0, undefined]);
        const k = officialKickers(rowsOf(CFB, 'st_kickers', VAN), CFB.espn_players, VAN);
        expect(k.find((r) => r.player_name === 'J.Dewers')?.source).toBeUndefined();
    });

    test('a kicker sportsdataverse split in two (full name + short name) is one ESPN line', () => {
        const rows = [
            { pos_team: 1, player_id: '9', player_name: 'Blake Craig', fg_attempts: 1, fg_made: 0, xp_attempts: 0, xp_made: 0, kickoffs: 0, fg_epa: -1 },
            { pos_team: 1, player_id: null, player_name: 'B.Craig', fg_attempts: 0, fg_made: 0, xp_attempts: 3, xp_made: 3, kickoffs: 5, kickoff_avg: 60, kickoff_epa: 0.5, fg_epa: 0 },
        ];
        const espn = [{ team_id: 1, category: 'kicking', athlete_id: '9', athlete: 'Blake Craig', 'fieldGoalsMade/fieldGoalAttempts': '0/1', 'extraPointsMade/extraPointAttempts': '3/3' }] as EspnPlayerRow[];
        const out = officialKickers(rows, espn, 1);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ player_name: 'Blake Craig', fg_made: 0, fg_attempts: 1, xp_made: 3, xp_attempts: 3, kickoffs: 5, kickoff_avg: 60, kickoff_epa: 0.5, source: 'espn' });
    });

    test('a player only ESPN lists is added, with no advanced numbers', () => {
        const out = officialRushing<any>([], CFB.espn_players, VAN, new Map());
        expect(out.length).toBe(CFB.espn_players.filter((r: any) => r.category === 'rushing' && r.team_id === VAN).length);
        expect(out.every((r) => r.source === 'espn' && r.EPA === undefined)).toBe(true);
    });

    test('a quarter or half (no ESPN rows) is the play-by-play box, unmarked', () => {
        const rows = rowsOf(CFB, 'pass', VAN);
        expect(officialPassing(rows, undefined, VAN, new Map())).toBe(rows);
    });

    test('no ESPN line for the team at all: every pbp line is marked', () => {
        const out = officialPassing(rowsOf(CFB, 'pass', VAN), [], VAN, new Map());
        expect(out.every((r) => r.source === 'pbp')).toBe(true);
        expect(out.map((r) => r.Comp)).toEqual(rowsOf(CFB, 'pass', VAN).map((r) => r.Comp));
    });
});

describe('name matching', () => {
    const espn = [
        { team_id: 1, category: 'kicking', athlete_id: '9', athlete: 'Jake Bates' },
        { team_id: 1, category: 'kicking', athlete_id: '10', athlete: 'Ja\'Marr Chase Jr.' },
    ] as EspnPlayerRow[];
    test('id first, then full name, then a unique initial + last name', () => {
        expect(new EspnCategory(espn, 1, 'kicking').find('anyone', '9')?.athlete_id).toBe('9');
        expect(new EspnCategory(espn, 1, 'kicking').find('JaMarr Chase')?.athlete_id).toBe('10');
        expect(new EspnCategory(espn, 1, 'kicking').find('J.Bates')?.athlete_id).toBe('9');
        expect(new EspnCategory(espn, 2, 'kicking').find('J.Bates')).toBeUndefined();
    });
    test('an initial shared by two players matches neither', () => {
        const two = [...espn, { team_id: 1, category: 'kicking', athlete_id: '11', athlete: 'Josh Bates' }] as EspnPlayerRow[];
        expect(new EspnCategory(two, 1, 'kicking').find('J.Bates')).toBeUndefined();
    });
});

describe('defense', () => {
    test('ESPN tackles replace the play-text count; NFL PD minus INT is PBU', () => {
        const espn = [
            { team_id: 5, category: 'defensive', athlete_id: '1', athlete: 'Kevin Byard', totalTackles: 10, soloTackles: 3, sacks: 0, tacklesForLoss: 1, passesDefended: 2, QBHits: 0 },
            { team_id: 5, category: 'interceptions', athlete_id: '1', athlete: 'Kevin Byard', interceptions: 1 },
            { team_id: 5, category: 'interceptions', athlete_id: '2', athlete: 'No Tackle', interceptions: 1 },
        ] as EspnPlayerRow[];
        const pbp = [{ jersey: 31, name: 'K.Byard', TOT: 7, SOLO: 2, AST: 5, TFL: 0, SACK: 0, INT: 0, PBU: 0, QBH: 0 }];
        const out = officialDefense(pbp, espn, 5, new Map(), 'nfl');
        expect(out[0]).toMatchObject({ name: 'K.Byard', TOT: 10, SOLO: 3, AST: 7, TFL: 1, INT: 1, PBU: 1, source: 'espn' });
        expect(out.find((r) => r.name === 'No Tackle')).toMatchObject({ INT: 1, source: 'espn' });
    });
    test('no ESPN defensive box: no interceptor-only rows are invented', () => {
        const espn = [{ team_id: 5, category: 'interceptions', athlete_id: '2', athlete: 'No Tackle', interceptions: 1 }] as EspnPlayerRow[];
        expect(officialDefense([], espn, 5, new Map(), 'cfb')).toEqual([]);
    });
});

describe('team box and the CFB era rules', () => {
    test('2026 CFB: ESPN numbers, no pbp marks', () => {
        const [away] = officialTeamBox(CFB, [VAN], 'cfb', 2026);
        const e = CFB.espn_team.find((r: any) => r.team_id === VAN);
        expect(away.total_yards).toEqual({ text: String(e.totalYards), pbp: false });
        expect(away.pass_yards.text).toBe(String(e.netPassingYards));
        expect(away.rushes.text).toBe(String(e.rushingAttempts));
        expect(away.rush_yards.text).toBe(String(e.rushingYards));
        expect(away.first_downs.text).toBe(String(e.firstDowns));
        expect(away.comp_att.text).toBe(`${e.completions}/${e.pass_attempts}`);
        expect(away.penalties.text).toBe(`${e.penalties}-${e.penalty_yards}`);
    });
    const old = (season: number) => officialTeamBox({
        espn_team: [{ team_id: 7, totalYards: 364, rushingYards: 23, netPassingYards: 367, totalPenaltiesYards: '0-0' }],
        team: [{ pos_team: 7, penalties: 9, penalty_yards: 54 }],
    }, [7], 'cfb', season)[0];
    test('before 2012, pass yards are total minus rush (O1: ESPN net passing adds sack yards back)', () => {
        expect(old(2008).pass_yards).toEqual({ text: '341', pbp: false });
        expect(old(2012).pass_yards.text).toBe('367');
    });
    test('2004-05 penalties are pbp (O6: ESPN reads "0-0")', () => {
        expect(old(2005).penalties).toEqual({ text: '9-54', pbp: true });
        expect(old(2006).penalties).toEqual({ text: '0-0', pbp: false });
    });
    test('the NFL keeps ESPN net passing in every season', () => {
        expect(officialTeamBox({ espn_team: [{ team_id: 7, totalYards: 364, rushingYards: 23, netPassingYards: 300 }] }, [7], 'nfl', 2008)[0].pass_yards.text).toBe('300');
    });
    test('no ESPN team row: every stat pbp had is shown, marked; the rest is a dash', () => {
        const [t] = officialTeamBox({ team: [{ pos_team: 7, off_yards: 400, rushes: 30 }] }, [7], 'cfb', 2026);
        expect(t.total_yards).toEqual({ text: '400', pbp: true });
        expect(t.rushes).toEqual({ text: '30', pbp: true });
        expect(t.possession).toEqual({ text: '—', pbp: false });
    });
});
