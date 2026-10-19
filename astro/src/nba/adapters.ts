/**
 * Data API rows -> the shapes blazing-the-nets' lib/ was written against. The arithmetic
 * is the same JavaScript d3-hexbin uses, so a league hex rebuilt from (i, j) lands on the
 * key the player's own hexbin produces (see sdv-db nba_shot_dashboards.py).
 */
import { lineOf, ZONES, type DistanceBin, type FieldGoals, type PlayerGame, type SideBin, type Split, type Zone } from './data/aggregate';
import type { PlayerGames } from './data/leaders';
import type { PlayerSeason, PlayerStats } from './data/players';
import type { ShotLite } from './data/shots';
import { BAR_BIN_FT, HEX_RADIUS, type LeagueContext } from './dashboard';
import type { LeagueContextRow, PlayerGameRow, SeasonPlayerRow, ShotApiRow } from '../resources/nbaShots';

const MAX_FT = 35;
const split = (attempts: number, makes: number): Split => ({ attempts, makes, fgPct: attempts > 0 ? makes / attempts : null });

function distanceBins(rows: LeagueContextRow[], binFt: number): DistanceBin[] {
    const n = Math.floor(MAX_FT / binFt) + 1;
    const acc = Array.from({ length: n }, () => ({ attempts: 0, makes: 0 }));
    let total = 0;
    for (const r of rows) {
        const b = acc[r.key1 ?? -1];
        if (!b) continue;
        b.attempts += r.attempts;
        b.makes += r.makes;
        total += r.attempts;
    }
    return acc.map((b, i) => ({ distance: i * binFt, ...split(b.attempts, b.makes), share: total ? b.attempts / total : 0 }));
}

/** Hex centres are rebuilt at HEX_RADIUS: the server binned the rows at that radius, so no other value is valid. */
export function leagueContextFromRows(rows: LeagueContextRow[]): LeagueContext {
    const radius = HEX_RADIUS;
    const dx = radius * 2 * Math.sin(Math.PI / 3);
    const dy = radius * 1.5;
    const by = (kind: string) => rows.filter((r) => r.kind === kind);
    const hexes = by('hex').map((r) => {
        const i = r.key1 ?? 0;
        const j = r.key2 ?? 0;
        // `|| 0` folds -0 into 0 so equal hexes share one key, as blazing's hexbinShots does
        return { x: (i + (j & 1) / 2) * dx || 0, y: j * dy || 0, attempts: r.attempts, fgPct: split(r.attempts, r.makes).fgPct };
    });
    const zoneRows = by('zone');
    const zones = Object.fromEntries(ZONES.map((z, k) => {
        const r = zoneRows.find((row) => row.key1 === k);
        return [z, split(r?.attempts ?? 0, r?.makes ?? 0)];
    })) as Record<Zone, Split>;
    const sideRows = by('side_3ft');
    const n = Math.floor(MAX_FT / BAR_BIN_FT) + 1;
    const sides: SideBin[] = Array.from({ length: n }, (_, bin) => {
        const at = (k: number) => sideRows.find((r) => r.key1 === bin && r.key2 === k);
        const s = (k: number) => split(at(k)?.attempts ?? 0, at(k)?.makes ?? 0);
        return { distance: bin * BAR_BIN_FT, left: s(0), centre: s(1), right: s(2) };
    });
    const total = by('total')[0];
    return {
        hexIndex: { radius, hexes, zones },
        byFoot: distanceBins(by('distance_1ft'), 1),
        byBin: distanceBins(by('distance_3ft'), BAR_BIN_FT),
        sides,
        fgPct: total ? split(total.attempts, total.makes).fgPct : null,
    };
}

function statsOf(r: SeasonPlayerRow): PlayerStats | null {
    if (!r.has_stats) return null;
    return {
        gp: r.gp ?? 0, min: r.min_pg, fga: r.fga_total, fg_pct: r.fg_pct, efg_pct: r.efg_pct, ts_pct: r.ts_pct,
        usg_pct: r.usg_pct, pie: r.pie, pts_pg: r.pts_pg, fga_pg: r.fga_pg, min_total: r.min_total,
    };
}

/**
 * blazing's `seasonPlayers`: league-wide (no teamId) sums a player's rows across teams and names
 * his primary team; for one team, that team's rows only, with `statsScope` "all-teams" when he
 * also shot for another. Sorted by attempts (desc) then person_id, as blazing's playerIndex.
 */
export function playerSeasonsFromRows(rows: SeasonPlayerRow[], teamId?: number): PlayerSeason[] {
    const out: PlayerSeason[] = [];
    if (teamId === undefined) {
        const byPerson = new Map<number, SeasonPlayerRow[]>();
        for (const r of rows) byPerson.set(r.person_id, [...(byPerson.get(r.person_id) ?? []), r]);
        for (const [person_id, mine] of byPerson) {
            const primary = mine.find((r) => r.is_primary) ?? mine[0];
            const sum = (k: 'attempts' | 'makes' | 'fg3a' | 'fg3m') => mine.reduce((a, r) => a + r[k], 0);
            out.push({
                person_id, player_name: primary.player_name, team_id: primary.team_id, team_tricode: primary.team_tricode,
                attempts: sum('attempts'), makes: sum('makes'), fg3a: sum('fg3a'), fg3m: sum('fg3m'),
                stats: statsOf(primary), statsScope: 'matching',
            });
        }
    } else {
        for (const r of rows) {
            if (r.team_id !== teamId) continue;
            out.push({
                person_id: r.person_id, player_name: r.player_name, team_id: r.team_id, team_tricode: r.team_tricode,
                attempts: r.attempts, makes: r.makes, fg3a: r.fg3a, fg3m: r.fg3m,
                stats: statsOf(r), statsScope: r.has_stats && r.n_teams > 1 ? 'all-teams' : 'matching',
            });
        }
    }
    return out.sort((a, b) => b.attempts - a.attempts || a.person_id - b.person_id);
}

/** person_id -> headshot URL for the rows that carry one (primary rows only, one per player). */
export function headshotsFromRows(rows: SeasonPlayerRow[]): Map<number, string> {
    const out = new Map<number, string>();
    for (const r of rows) if (r.is_primary && r.headshot_href) out.set(r.person_id, r.headshot_href);
    return out;
}

/** Tricodes of every team he shot for this season, most attempts first (the page header). */
export function teamsOfPlayer(rows: SeasonPlayerRow[], personId: number): string[] {
    return rows.filter((r) => r.person_id === personId).sort((a, b) => b.attempts - a.attempts || Number(b.is_primary) - Number(a.is_primary)).map((r) => r.team_tricode);
}

/**
 * blazing's `playerGames`: date order then game_id. A row the logs could not place (NULL date)
 * makes the whole per-game view unavailable, exactly as blazing's `gamesOrNull` does, rather than
 * drawing a wrong order.
 */
export function playerGamesFromRows(rows: PlayerGameRow[]): PlayerGame[] | null {
    const out: PlayerGame[] = [];
    for (const r of rows) {
        if (r.game_date === null || r.opponent_id === null || r.opponent === null || r.venue === null) return null;
        out.push({
            game_id: r.game_id, date: r.game_date, team_id: r.team_id, opponent_id: r.opponent_id, opponent: r.opponent,
            venue: r.venue, win: r.win,
            ...lineOf({ attempts: r.attempts, makes: r.makes, fg3a: r.fg3a, fg3m: r.fg3m }),
        });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id));
}

/**
 * blazing's `seasonPlayerGames` over the derived rows: every player's games in date order for
 * the rolling leaderboards. A player with a game the logs cannot place (NULL date, opponent or
 * venue) is left out rather than failing the page, as blazing does; his team is the one in his
 * latest game.
 */
export function seasonPlayerGamesFromRows(gameRows: PlayerGameRow[], playerRows: SeasonPlayerRow[]): PlayerGames[] {
    const byPerson = new Map<number, PlayerGameRow[]>();
    for (const r of gameRows) {
        const mine = byPerson.get(r.person_id);
        if (mine) mine.push(r); else byPerson.set(r.person_id, [r]);
    }
    const names = new Map<number, string>();
    for (const r of playerRows) if (r.is_primary || !names.has(r.person_id)) names.set(r.person_id, r.player_name);
    const out: PlayerGames[] = [];
    for (const [person_id, rows] of byPerson) {
        const games = playerGamesFromRows(rows);
        if (games === null || games.length === 0) continue;
        const last = games[games.length - 1];
        const lastRow = rows.find((r) => r.game_id === last.game_id) ?? rows[0];
        out.push({ person_id, name: names.get(person_id) ?? String(person_id), team_id: last.team_id, team: lastRow.team_tricode, games });
    }
    return out;
}

/** person_id -> his season field goals summed over his team rows (the season line "Most improved" compares with when the game rows are a window). */
export function seasonLinesFromRows(rows: SeasonPlayerRow[]): Map<number, FieldGoals> {
    const out = new Map<number, FieldGoals>();
    for (const r of rows) {
        const s = out.get(r.person_id) ?? { attempts: 0, makes: 0, fg3a: 0, fg3m: 0 };
        out.set(r.person_id, { attempts: s.attempts + r.attempts, makes: s.makes + r.makes, fg3a: s.fg3a + r.fg3a, fg3m: s.fg3m + r.fg3m });
    }
    return out;
}

export function shotsFromRows(rows: ShotApiRow[]): ShotLite[] {
    return rows.map((r) => ({
        game_id: String(r.game_id), x_legacy: Number(r.x_legacy), y_legacy: Number(r.y_legacy),
        shot_distance: Number(r.shot_distance), shot_value: Number(r.shot_value), shot_result: r.shot_result,
    }));
}
