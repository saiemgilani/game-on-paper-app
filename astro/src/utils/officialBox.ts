/**
 * The football game page's counting stats come from ESPN's own box score.
 *
 * sportsdataverse ships ESPN's summary `boxscore` with every game, as
 * `advBoxScore.espn_players` (one row per athlete per category) and
 * `advBoxScore.espn_team` (one row per team). Those are the official numbers.
 * The rest of the advanced box is derived from the play-by-play, and its
 * counts follow its own definitions (CFB sacks are not QB rushes, NFL pass
 * yards are gross, kneels are dropped) and its parser's misses. So the counts
 * a reader checks against the book (C/ATT, yards, TD, INT, carries,
 * receptions, kicking, punting, returns, tackles) are read from ESPN here, and
 * EPA, success rate, WPA and every rate stay on the play-by-play.
 *
 * Fallback: a line ESPN does not list keeps its play-by-play counts and is
 * marked `source: 'pbp'`, so nothing pbp had a number for goes blank. ESPN
 * publishes the box for the whole game only, so a quarter or half window
 * passes no ESPN rows and renders the play-by-play counts unmarked.
 *
 * Era rules (team box, CFB), from the 2026-10-11 ESPN play-text audit:
 * - before 2012 ESPN's team `netPassingYards` adds sack yards back (O1);
 *   pass yards are `totalYards - rushingYards` instead.
 * - 2004-05 ESPN team penalties read "0-0" in 97% of games (O6); those
 *   seasons take the play-by-play count.
 * The 2004-11 player lines are incomplete (O2: some players are missing, so
 * category sums fall short of team totals); the per-line fallback covers that.
 */
import type { League } from './league';

export interface EspnPlayerRow {
    team_id: number | null
    category: string
    athlete_id: string | null
    athlete: string | null
    [stat: string]: unknown
}

export interface EspnTeamRow {
    team_id: number
    [stat: string]: unknown
}

/** Where a line's counting stats came from. */
export type LineSource = 'espn' | 'pbp';

/** Seasons whose ESPN team `netPassingYards` is gross (O1). */
export const CFB_NET_PASSING_FROM = 2012;
/** Seasons whose ESPN team penalties are blank "0-0" (O6). */
export const CFB_PENALTIES_FROM = 2006;

const n = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
};

/** "17/25", "17-25" or "4-37" -> [17, 25]; anything else -> [null, null]. */
export function pair(v: unknown): [number | null, number | null] {
    const m = /^\s*(-?\d+)\s*[/-]\s*(-?\d+)\s*$/.exec(String(v ?? ''));
    return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

/**
 * Lower-case ASCII name without punctuation or suffixes, for matching:
 * "Ja'Marr Chase Jr." -> "jamarr chase", "A.J. Brown" / "AJ Brown" -> "aj brown",
 * "J.Bates" -> "j bates".
 */
export function nameKey(s: unknown): string {
    const words = String(s ?? '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/['’]/g, '').replace(/[.-]/g, ' ').replace(/[^a-z ]/g, '')
        .split(/\s+/).filter((w) => w && !['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(w));
    // run-together initials ("a j" -> "aj"), but a lone initial before a surname stays one
    const out: string[] = [];
    for (let i = 0; i < words.length; i++) {
        if (words[i].length === 1 && words[i + 1]?.length === 1) {
            let run = words[i];
            while (words[i + 1]?.length === 1) run += words[++i];
            out.push(run);
        } else out.push(words[i]);
    }
    return out.join(' ');
}

/** "Austin Simmons" / "A.Simmons" / "A. Simmons" -> "a simmons". */
function initialKey(s: unknown): string {
    const w = nameKey(s).split(' ').filter(Boolean);
    return w.length < 2 ? w.join(' ') : `${w[0][0]} ${w.slice(1).join(' ')}`;
}

/**
 * One team's ESPN rows of one category, claimed as pbp lines match them, so
 * the leftovers (players ESPN lists and the play-by-play does not) can be
 * shown after the matched lines.
 */
export class EspnCategory {
    readonly rows: EspnPlayerRow[];
    private claimed = new Set<EspnPlayerRow>();

    constructor(all: EspnPlayerRow[] | null | undefined, teamId: string | number, category: string) {
        this.rows = (all ?? []).filter((r) => r?.category === category && String(r.team_id) === String(teamId));
    }

    /** By ESPN athlete id, then full name, then first initial + last name (only when unique). */
    find(name: unknown, id?: unknown, among: 'open' | 'claimed' = 'open'): EspnPlayerRow | undefined {
        const open = this.rows.filter((r) => this.claimed.has(r) === (among === 'claimed'));
        const tries: Array<(r: EspnPlayerRow) => boolean> = [];
        if (id != null && id !== '') tries.push((r) => String(r.athlete_id) === String(id));
        const full = nameKey(name);
        if (full) tries.push((r) => nameKey(r.athlete) === full);
        const init = initialKey(name);
        if (init.includes(' ')) tries.push((r) => initialKey(r.athlete) === init);
        for (const t of tries) {
            const hits = open.filter(t);
            if (hits.length === 1) {
                this.claimed.add(hits[0]);
                return hits[0];
            }
        }
        return undefined;
    }

    unclaimed(): EspnPlayerRow[] {
        return this.rows.filter((r) => !this.claimed.has(r));
    }
}

type Row = Record<string, any>;
export type Sourced<T> = T & { source?: LineSource, espn_athlete_id?: string | null };

/**
 * Overlays one category: each pbp row takes ESPN's counts when ESPN lists the
 * player, else is marked pbp; ESPN-only players are appended, built by `blank`.
 * `espn` undefined (a window, or a processor without the box) returns the rows untouched.
 */
function overlay<T extends Row>(
    rows: T[],
    espn: EspnPlayerRow[] | undefined,
    teamId: string | number,
    category: string,
    nameOf: (r: T) => unknown,
    idOf: (r: T) => unknown,
    counts: (e: EspnPlayerRow, r: T | null) => Row,
    blank: (e: EspnPlayerRow) => T,
    merge?: (kept: T, dup: T) => T,
): Sourced<T>[] {
    if (!espn) return rows;
    const cat = new EspnCategory(espn, teamId, category);
    const out: Sourced<T>[] = [];
    for (const r of rows) {
        const e = cat.find(nameOf(r), idOf(r));
        if (e) {
            out.push({ ...r, ...counts(e, r), source: 'espn', espn_athlete_id: e.athlete_id });
            continue;
        }
        // sportsdataverse can split one kicker into two rows ("Blake Craig" with the FGs,
        // "B.Craig" with the XPs and kickoffs): fold the second into the line ESPN already gave
        const dupOf = merge && cat.find(nameOf(r), idOf(r), 'claimed');
        const kept = dupOf && out.find((o) => o.espn_athlete_id === dupOf.athlete_id);
        if (kept) Object.assign(kept, merge!(kept, r), counts(dupOf, kept));
        else out.push({ ...r, source: 'pbp' });
    }
    for (const e of cat.unclaimed()) {
        out.push({ ...blank(e), ...counts(e, null), source: 'espn', espn_athlete_id: e.athlete_id });
    }
    return out;
}

const keepOr = (espn: number | null, pbp: unknown) => espn ?? n(pbp) ?? 0;

export function officialPassing<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number, ids: Map<string, string>): Sourced<T>[] {
    return overlay(rows, espn, teamId, 'passing', (r) => r.passer_player_name, (r) => ids.get(String(r.passer_player_name ?? '')),
        (e, r) => {
            const [comp, att] = pair(e['completions/passingAttempts']);
            // the NFL box carries sacks per passer; the college box has none, so CFB keeps the pbp count
            const [sacks] = pair(e['sacks-sackYardsLost']);
            return {
                Comp: keepOr(comp, r?.Comp), Att: keepOr(att, r?.Att), Yds: keepOr(n(e.passingYards), r?.Yds),
                Pass_TD: keepOr(n(e.passingTouchdowns), r?.Pass_TD), Int: keepOr(n(e.interceptions), r?.Int),
                Sck: keepOr(sacks, r?.Sck),
            };
        },
        (e) => ({ pos_team: e.team_id, passer_player_name: e.athlete }) as unknown as T);
}

export function officialRushing<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number, ids: Map<string, string>): Sourced<T>[] {
    return overlay(rows, espn, teamId, 'rushing', (r) => r.rusher_player_name, (r) => ids.get(String(r.rusher_player_name ?? '')),
        (e, r) => ({
            Car: keepOr(n(e.rushingAttempts), r?.Car), Yds: keepOr(n(e.rushingYards), r?.Yds),
            Rush_TD: keepOr(n(e.rushingTouchdowns), r?.Rush_TD),
        }),
        (e) => ({ pos_team: e.team_id, rusher_player_name: e.athlete, Fum: 0, Fum_Lost: 0 }) as unknown as T);
}

export function officialReceiving<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number, ids: Map<string, string>): Sourced<T>[] {
    // ESPN lists no zero-catch target, so a pbp line of 0 rec / 0 yds / 0 TD agrees with the
    // book by omission and is not marked (only its targets are pbp, as on every CFB line)
    const zero = (r: Row) => !n(r.Rec) && !n(r.Yds) && !n(r.Rec_TD);
    return officialReceivingLines(rows, espn, teamId, ids).map((r) => (r.source === 'pbp' && zero(r) ? { ...r, source: undefined } : r));
}

function officialReceivingLines<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number, ids: Map<string, string>): Sourced<T>[] {
    return overlay(rows, espn, teamId, 'receiving', (r) => r.receiver_player_name, (r) => ids.get(String(r.receiver_player_name ?? '')),
        (e, r) => ({
            Rec: keepOr(n(e.receptions), r?.Rec), Yds: keepOr(n(e.receivingYards), r?.Yds),
            Rec_TD: keepOr(n(e.receivingTouchdowns), r?.Rec_TD),
            // NFL only: the college box has no targets, so CFB keeps the pbp count
            Tar: n(e.receivingTargets) ?? r?.Tar ?? null,
        }),
        (e) => ({ pos_team: e.team_id, receiver_player_name: e.athlete, Fum: 0, Fum_Lost: 0 }) as unknown as T);
}

export function officialKickers<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number): Sourced<T>[] {
    // ESPN's kicking box lists FG / XP kickers only: a kickoff-only line agrees with it by omission
    // (kickoffs are pbp on every line), so it is not marked
    const none = (r: Row) => !n(r.fg_attempts) && !n(r.xp_attempts);
    return kickerLines(rows, espn, teamId).map((r) => (r.source === 'pbp' && none(r) ? { ...r, source: undefined } : r));
}

function kickerLines<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number): Sourced<T>[] {
    return overlay(rows, espn, teamId, 'kicking', (r) => r.player_name, (r) => r.player_id,
        (e, r) => {
            const [fgm, fga] = pair(e['fieldGoalsMade/fieldGoalAttempts']);
            const [xpm, xpa] = pair(e['extraPointsMade/extraPointAttempts']);
            const long = n(e.longFieldGoalMade);
            return {
                fg_made: keepOr(fgm, r?.fg_made), fg_attempts: keepOr(fga, r?.fg_attempts),
                fg_long: fgm ? long : (fgm === 0 ? null : r?.fg_long ?? null),
                xp_made: keepOr(xpm, r?.xp_made), xp_attempts: keepOr(xpa, r?.xp_attempts),
            };
        },
        (e) => ({ pos_team: e.team_id, player_id: e.athlete_id, player_name: e.athlete, kickoffs: 0 }) as unknown as T,
        (a, b) => {
            // kickoffs are pbp-only (ESPN's box has none): take them from the row that has them
            const ko: Row = (n(b.kickoffs) ?? 0) > (n(a.kickoffs) ?? 0) ? b : a;
            const kick = Object.fromEntries(Object.entries(ko).filter(([k]) => k.startsWith('kickoff')));
            const range = Object.fromEntries(Object.keys(a).filter((k) => /^fg_\d/.test(k)).map((k) => [k, (n(a[k]) ?? 0) + (n(b[k]) ?? 0)]));
            return { ...a, ...range, ...kick, fg_epa: (n(a.fg_epa) ?? 0) + (n(b.fg_epa) ?? 0) } as T;
        });
}

export function officialPunters<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number): Sourced<T>[] {
    return overlay(rows, espn, teamId, 'punting', (r) => r.player_name, (r) => r.player_id,
        (e, r) => ({
            punts: keepOr(n(e.punts), r?.punts), punt_avg: keepOr(n(e.grossAvgPuntYards), r?.punt_avg),
            punt_long: n(e.longPunt) ?? r?.punt_long ?? null,
            punt_inside_20: keepOr(n(e.puntsInside20), r?.punt_inside_20), punt_touchbacks: keepOr(n(e.touchbacks), r?.punt_touchbacks),
        }),
        // ESPN has no net average; an ESPN-only punter shows none rather than a made-up one
        (e) => ({ pos_team: e.team_id, player_id: e.athlete_id, player_name: e.athlete, punt_net_avg: null }) as unknown as T,
        // a split punter keeps the row with more punts (its net average) and both EPAs
        (a, b) => ({ ...((n(b.punts) ?? 0) > (n(a.punts) ?? 0) ? b : a), punt_epa: (n(a.punt_epa) ?? 0) + (n(b.punt_epa) ?? 0) }) as T);
}

/** Kick and punt returns are two ESPN categories folded into one GOP returner line. */
export function officialReturners<T extends Row>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number): Sourced<T>[] {
    if (!espn) return rows;
    const kr = new EspnCategory(espn, teamId, 'kickReturns');
    const pr = new EspnCategory(espn, teamId, 'puntReturns');
    const fold = (base: Row, k?: EspnPlayerRow, p?: EspnPlayerRow): Row => ({
        ...base,
        ...(k ? {
            kick_returns: n(k.kickReturns) ?? 0, kick_return_yards: n(k.kickReturnYards) ?? 0, kick_return_avg: n(k.yardsPerKickReturn) ?? 0,
            kick_return_long: n(k.longKickReturn), kick_return_tds: n(k.kickReturnTouchdowns) ?? 0,
        } : {}),
        ...(p ? {
            punt_returns: n(p.puntReturns) ?? 0, punt_return_yards: n(p.puntReturnYards) ?? 0, punt_return_avg: n(p.yardsPerPuntReturn) ?? 0,
            punt_return_long: n(p.longPuntReturn), punt_return_tds: n(p.puntReturnTouchdowns) ?? 0,
        } : {}),
    });
    const out: Sourced<T>[] = rows.map((r) => {
        const k = kr.find(r.player_name, r.player_id);
        const p = pr.find(r.player_name, r.player_id);
        // a returner ESPN lists in only one category takes that one; the other stays pbp
        return (k || p) ? { ...(fold(r, k, p) as T), source: 'espn', espn_athlete_id: (k ?? p)!.athlete_id } : { ...r, source: 'pbp' };
    });
    const left = new Map<string, { k?: EspnPlayerRow, p?: EspnPlayerRow }>();
    for (const k of kr.unclaimed()) left.set(String(k.athlete_id), { ...left.get(String(k.athlete_id)), k });
    for (const p of pr.unclaimed()) left.set(String(p.athlete_id), { ...left.get(String(p.athlete_id)), p });
    for (const { k, p } of left.values()) {
        const e = (k ?? p)!;
        const zero = { kick_returns: 0, punt_returns: 0 };
        out.push({ ...(fold({ pos_team: e.team_id, player_id: e.athlete_id, player_name: e.athlete, ...zero }, k, p) as T), source: 'espn', espn_athlete_id: e.athlete_id });
    }
    return out;
}

export interface DefenseLike {
    name: string
    TOT: number
    SOLO: number
    AST: number
    TFL: number
    SACK: number
    INT: number
    PBU: number
    QBH: number
}

/**
 * The defensive lines GOP reads from the tacklers in the play text, with ESPN's
 * tackles, sacks, TFL, PD, hurries (CFB) or QB hits (NFL) and interceptions.
 * ESPN's NFL passes defended include the player's interceptions, its college
 * ones do not (sportsdataverse `espn_passes_defended`); PBU is PD without them.
 */
export function officialDefense<T extends DefenseLike>(rows: T[], espn: EspnPlayerRow[] | undefined, teamId: string | number, ids: Map<string, string>, league: League): Sourced<T>[] {
    if (!espn) return rows;
    const ints = new EspnCategory(espn, teamId, 'interceptions');
    const intsOf = (e: EspnPlayerRow) => n(ints.rows.find((i) => String(i.athlete_id) === String(e.athlete_id))?.interceptions) ?? 0;
    const counts = (e: EspnPlayerRow): Partial<DefenseLike> => {
        const tot = n(e.totalTackles) ?? 0, solo = n(e.soloTackles) ?? 0, int = intsOf(e);
        const pd = n(e.passesDefended) ?? 0;
        return {
            TOT: tot, SOLO: solo, AST: Math.max(0, tot - solo), TFL: n(e.tacklesForLoss) ?? 0, SACK: n(e.sacks) ?? 0,
            INT: int, PBU: Math.max(0, league === 'nfl' ? pd - int : pd), QBH: n(e.hurries ?? e.QBHits) ?? 0,
        };
    };
    const out = overlay(rows as unknown as Row[], espn, teamId, 'defensive', (r) => r.name, (r) => ids.get(String(r.name ?? '')),
        (e) => counts(e), (e) => ({ name: e.athlete }) as Row) as unknown as Sourced<T>[];
    // an interceptor with no tackle has no defensive row on ESPN: add him from his INT line.
    // Only when ESPN has a defensive box for the team: without one a tackle count of 0 would be made up.
    const hasDefense = new EspnCategory(espn, teamId, 'defensive').rows.length > 0;
    for (const i of hasDefense ? ints.rows : []) {
        if (out.some((r) => String(r.espn_athlete_id) === String(i.athlete_id))) continue;
        const pbp = out.find((r) => r.source === 'pbp' && (nameKey(r.name) === nameKey(i.athlete) || initialKey(r.name) === initialKey(i.athlete)));
        if (pbp) {
            Object.assign(pbp, { INT: n(i.interceptions) ?? 0, source: 'espn', espn_athlete_id: i.athlete_id });
        } else {
            out.push({ name: String(i.athlete ?? ''), TOT: 0, SOLO: 0, AST: 0, TFL: 0, SACK: 0, INT: n(i.interceptions) ?? 0, PBU: 0, QBH: 0, source: 'espn', espn_athlete_id: i.athlete_id } as unknown as Sourced<T>);
        }
    }
    return out.filter((r) => r.TOT > 0 || r.PBU > 0 || r.QBH > 0 || r.INT > 0 || r.SACK > 0)
        .sort((a, b) => b.TOT - a.TOT || b.SOLO - a.SOLO || String(a.name).localeCompare(String(b.name)));
}

/** One cell of the official team box: the shown text and whether it fell back to pbp. */
export interface TeamCell {
    text: string
    pbp: boolean
}

export const OFFICIAL_TEAM_ROWS = [
    ['first_downs', 'First Downs'],
    ['total_yards', 'Total Yards'],
    ['comp_att', 'Comp/Att'],
    ['pass_yards', 'Pass Yards'],
    ['rushes', 'Rushes'],
    ['rush_yards', 'Rush Yards'],
    ['third_down', '3rd Down'],
    ['fourth_down', '4th Down'],
    ['penalties', 'Penalties'],
    ['turnovers', 'Turnovers'],
    ['possession', 'Possession'],
] as const;
export type OfficialTeamKey = typeof OFFICIAL_TEAM_ROWS[number][0];
export type OfficialTeamRow = { pos_team: number } & Record<OfficialTeamKey, TeamCell>;

/**
 * Per team, the traditional team box: ESPN's numbers, with the CFB era rules
 * above, and the play-by-play count (marked) for any stat ESPN left out.
 */
export function officialTeamBox(box: Row | null | undefined, teamIds: (string | number)[], league: League, season: number): OfficialTeamRow[] {
    const espn: EspnTeamRow[] = box?.espn_team ?? [];
    const of = (k: string, id: string | number): Row => (box?.[k] ?? []).find((r: Row) => String(r.pos_team) === String(id)) ?? {};
    return teamIds.map((id) => {
        const e: Row = espn.find((r) => String(r.team_id) === String(id)) ?? {};
        const t = of('team', id), u = of('team_usage', id), to = of('turnover', id);
        const passRows: Row[] = (box?.pass ?? []).filter((r: Row) => String(r.pos_team) === String(id));
        const sum = (k: string) => passRows.reduce((s, r) => s + (n(r[k]) ?? 0), 0);
        const cell = (espnText: string | null, pbpText: string | null): TeamCell =>
            espnText != null ? { text: espnText, pbp: false } : { text: pbpText ?? '—', pbp: pbpText != null };
        const num = (v: unknown) => (n(v) == null ? null : String(n(v)));
        const slash = ([a, b]: [number | null, number | null]) => (a == null || b == null ? null : `${a}/${b}`);
        const dash = ([a, b]: [number | null, number | null]) => (a == null || b == null ? null : `${a}-${b}`);

        const total = n(e.totalYards), rush = n(e.rushingYards);
        const pass = league === 'cfb' && season < CFB_NET_PASSING_FROM
            ? (total != null && rush != null ? total - rush : null)
            : n(e.netPassingYards);
        const penalties = league === 'cfb' && season < CFB_PENALTIES_FROM ? null : dash(pair(e.totalPenaltiesYards));
        const pbpFirst = n(t.first_downs_created) == null ? null : (n(t.first_downs_created) ?? 0) + (n(t.penalty_first_downs_created) ?? 0);
        return {
            pos_team: Number(id),
            first_downs: cell(num(e.firstDowns), pbpFirst == null ? null : String(pbpFirst)),
            total_yards: cell(num(total), num(t.off_yards)),
            comp_att: cell(slash(pair(e.completionAttempts)), passRows.length ? `${sum('Comp')}/${sum('Att')}` : null),
            pass_yards: cell(pass == null ? null : String(pass), num(t.pass_yards)),
            rushes: cell(num(e.rushingAttempts), num(t.rushes)),
            rush_yards: cell(num(rush), num(t.rush_yards)),
            third_down: cell(slash(pair(e.thirdDownEff)), u.third_down_opportunities == null ? null : `${n(u.third_down_conversions) ?? 0}/${n(u.third_down_opportunities) ?? 0}`),
            fourth_down: cell(slash(pair(e.fourthDownEff)), null),
            penalties: cell(penalties, n(t.penalties) == null ? null : `${n(t.penalties)}-${n(t.penalty_yards) ?? 0}`),
            turnovers: cell(num(e.turnovers), num(to.turnovers)),
            // rendered as HTML by TeamMetricsTable: only a clock string gets through
            possession: cell(/^\d{1,2}:\d{2}$/.test(String(e.possessionTime ?? '')) ? String(e.possessionTime) : null, null),
        };
    });
}
