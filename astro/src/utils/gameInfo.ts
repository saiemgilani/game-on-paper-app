/**
 * BB-G42's Game info (behind 'bball-game-info'): the officiating crew joined to each official's season profile
 * (official_seasons, BB-D34) and the league's average official, and the pros' injury report. Pure: the reads are
 * resources/gameInfo.ts, the page components/nba/game/NbaGameInfo.astro.
 */
import type { ESPNGameSummary } from '../resources/espn';

/** One official on the game's crew, from ESPN's summary (live, pregame) or the `{lg}.officials` table (an ingested final). */
export interface GameOfficial { name: string; /** ESPN's id where the source carries one (the WNBA and WBB tables); else null */ id: number | null }

/** The rates official_seasons publishes, each with `<rate>_n`, the games it is over. */
export const OFFICIAL_RATES = ['fouls_per_game', 'fta_per_game', 'pace', 'home_win_pct', 'home_minus_away_fouls'] as const;
export type OfficialRate = typeof OFFICIAL_RATES[number];

/** One official's regular season (sdv-py `_common.official_seasons`). */
export type OfficialSeason = { season: number; official_id: number | null; official_name: string | null; games: number }
    & { [K in OfficialRate]: number | null } & { [K in `${OfficialRate}_n`]: number | null };

/** One player on a team's injury report. */
export interface InjuryEntry { teamId: number; athleteId: number | null; name: string; status: string | null; injury: string | null; returnDate: string | null }

export interface GameInfoReads {
    officials: GameOfficial[];
    /** the game season's official_seasons rows; empty when the season has no officials release (no profiles drawn) */
    profiles: OfficialSeason[];
    /** the pros only (college has no injury source): ESPN's current report pregame and live (`snapshot` false); for a final
     * the last espn_injuries snapshot filed by the game day, `asOf` its date (null: none on file in the window) */
    injuries?: { snapshot: boolean; asOf: string | null; rows: InjuryEntry[] };
}

/** official_seasons keys the NBA and MBB by the whitespace-normalised name; case is folded here too. */
export const officialKey = (name: string | null | undefined): string => (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The crew in ESPN's order, a duplicate (same id, else same name) once. */
function crew(rows: { name: string | null; id: number | null; order: number | null }[]): GameOfficial[] {
    const seen = new Set<string>();
    return rows.filter((r) => r.name).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).flatMap((r) => {
        const key = r.id != null ? `id:${r.id}` : officialKey(r.name);
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ name: r.name!.replace(/\s+/g, ' ').trim(), id: r.id }];
    });
}

export const officialsFromSummary = (summary: ESPNGameSummary | null): GameOfficial[] =>
    crew((summary?.gameInfo?.officials ?? []).map((o) => ({ name: str(o?.fullName) ?? str(o?.displayName), id: num(o?.id), order: num(o?.order) })));

/** `{nba,mbb}.officials` (no id) and `{wnba,wbb}.officials` (ESPN's `official_id`) alike. */
export const officialsFromTable = (rows: Record<string, any>[]): GameOfficial[] =>
    crew(rows.map((r) => ({ name: str(r.official_full_name) ?? str(r.official_display_name), id: num(r.official_id), order: num(r.official_order) })));

/** "Knee (right), sprain": ESPN's body part, side and detail; its "Not Specified" detail is left out. */
export function injuryText(type: unknown, side: unknown, detail: unknown): string | null {
    const t = str(type), s = str(side), d = str(detail);
    if (!t) return null;
    return `${t}${s && s !== 'Not Specified' ? ` (${s.toLowerCase()})` : ''}${d && d !== 'Not Specified' ? `, ${d.toLowerCase()}` : ''}`;
}

export const injuriesFromSummary = (summary: ESPNGameSummary | null): InjuryEntry[] =>
    (summary?.injuries ?? []).flatMap((t) => (t?.injuries ?? []).map((i) => ({
        teamId: Number(t?.team?.id), athleteId: num(i?.athlete?.id), name: str(i?.athlete?.displayName) ?? '',
        status: str(i?.status), injury: injuryText(i?.details?.type, i?.details?.side, i?.details?.detail), returnDate: str(i?.details?.returnDate),
    }))).filter((r) => r.name && Number.isFinite(r.teamId));

/** `{nba,wnba}.espn_injuries` rows (one league-wide snapshot per `as_of_date`), the two teams' only. */
export const injuriesFromSnapshot = (rows: Record<string, any>[], teamIds: number[]): InjuryEntry[] =>
    rows.filter((r) => teamIds.includes(Number(r.team_id))).map((r) => ({
        teamId: Number(r.team_id), athleteId: num(r.athlete_id), name: str(r.athlete_display_name) ?? '',
        status: str(r.status), injury: injuryText(r.detail_type, r.detail_side, r.detail_detail), returnDate: str(r.detail_return_date),
    })).filter((r) => r.name);

/** The league's average official: each rate over every official's games, weighted by the games it is over (`_n`). */
export function leagueAverage(rows: OfficialSeason[]): Record<OfficialRate, number | null> {
    const out = {} as Record<OfficialRate, number | null>;
    for (const k of OFFICIAL_RATES) {
        let sum = 0, n = 0;
        for (const r of rows) {
            const v = num(r[k]), w = num(r[`${k}_n`]);
            if (v != null && w != null && w > 0) { sum += v * w; n += w; }
        }
        out[k] = n > 0 ? sum / n : null;
    }
    return out;
}

/** Each official's profile: by ESPN id where both sides carry one, else by name; null when the season has none for them. */
export function profileFor(o: GameOfficial, rows: OfficialSeason[]): OfficialSeason | null {
    if (o.id != null) {
        const byId = rows.find((r) => num(r.official_id) === o.id);
        if (byId) return byId;
    }
    const key = officialKey(o.name);
    return rows.find((r) => officialKey(r.official_name) === key) ?? null;
}

/** The latest `as_of_date` among snapshot rows; null with none. */
export const latestSnapshot = (rows: Record<string, any>[]): string | null =>
    rows.reduce<string | null>((m, r) => (typeof r.as_of_date === 'string' && (m == null || r.as_of_date > m) ? r.as_of_date : m), null);

/** "2026-11-09" moved by whole days. */
export const shiftDate = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The ESPN calendar day a game is on (US Eastern), the `as_of_date` its injury snapshot is filed under. */
export function easternDate(iso: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
