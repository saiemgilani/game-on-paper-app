/**
 * Two separate things about a game that is in progress right now, kept apart on
 * purpose (review on #268: "We should mark if a game is live separate from if
 * there are any data issues, and even if there are data issues, they should
 * only be shown to admin"):
 *
 *   LIVE  -- ESPN says the game is being played. Public, generic, and free:
 *            it comes from the KV-cached scoreboard and nothing else.
 *   QA    -- what the API served and what its gate said about the payload.
 *            ADMIN ONLY, and only fetched for an admin, so a public reader of
 *            a live player page costs no processing read at all.
 *
 * It reads the `qa` block GOP #265 attaches to every `/process` response
 * (`docs/qa-payload.md`), through the SAME `retrieveProcessedGame` path and the
 * same cache key the game page uses -- so a live game a reader already has open
 * costs this page nothing, and a cold one is the one processing run the game
 * page would do anyway. Never a second run: the key does not vary here.
 *
 * Three states, on purpose:
 *   payload unavailable  -> no entry, and the row renders exactly as before
 *   `qa` absent or null  -> the served source alone (today's production state:
 *                           #265 is not merged, so nothing sends a `qa` block,
 *                           and null is documented as *unmeasured*, not clean)
 *   `qa` present         -> source, fallback flag, verdict, anomaly count
 */
import { getCurrentScoreboard, type ESPNScheduleEvent } from '../resources/espn';
import { retrieveProcessedGame, type ProcessedGame } from '../resources/python';
import { CURRENT_SEASON_CONFIG } from './config';
import { CURRENT_YEAR } from './constants';
import type { League } from './league';
import { numberOrNull } from './misc';
import { espnGameId, type PlayerGameRow } from './players';

export interface LiveQaBadge {
    /** the feed that produced the game; ESPN when nothing says otherwise */
    source: string
    /** the API served a different feed than the request asked for */
    fallback: boolean
    /** null when the response carried no `qa` block: source only, never "ok" */
    verdict: string | null
    /** live warn/info tier -- the source misbehaved, not the page */
    anomalies: number
    /** admin detail, mirroring #263's: the gate's top rules as `rule×n` */
    rules: string
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** ESPN's own word for a game in progress, as `admin/api/staleness.ts` reads it. */
const inProgress = (g: ESPNScheduleEvent): boolean =>
    ((g.competitions?.[0] as any)?.status ?? (g as any).status)?.type?.state === 'in';

/**
 * Counts first, because they are what a person acts on; `ok`/`not ok` only when
 * the gate could not count (a pin without `sportsdataverse.validation` reads
 * both counts null while the live rules still answer).
 */
function verdict(qa: NonNullable<NonNullable<ProcessedGame['qa']>>): string {
    const parts: string[] = [];
    if (qa.n_errors) parts.push(plural(qa.n_errors, 'error', 'errors'));
    if (qa.n_warnings) parts.push(plural(qa.n_warnings, 'warning', 'warnings'));
    if (parts.length > 0) return parts.join(', ');
    return qa.ok ? 'ok' : 'not ok';
}

/** The badge for one processed payload. Pure, so the shapes are testable alone. */
export function qaBadge(game: ProcessedGame): LiveQaBadge {
    const qa = game?.qa ?? null;
    return {
        source: qa?.provenance?.source || 'espn',
        fallback: qa?.provenance?.fallback_used === true,
        verdict: qa ? verdict(qa) : null,
        anomalies: qa?.live?.anomalies?.length ?? 0,
        rules: (qa?.top_rules ?? []).map((r) => `${r.rule}×${r.n}`).join(', '),
    };
}

/** The QA line's copy, mirroring #263's `data-admin-provenance` span. Admin only. */
export function badgeText(b: LiveQaBadge): string {
    let text = `Served: ${b.source}${b.fallback ? ' (fallback)' : ''}`;
    if (b.verdict) text += `, QA ${b.verdict}`;
    if (b.anomalies > 0) text += `, ${plural(b.anomalies, 'anomaly', 'anomalies')}`;
    return text;
}

/** What a game-log row knows about a game in progress. */
export interface LiveGameStatus {
    /** ESPN says it is being played; the only thing the public badge needs */
    live: true
    /** admin only, and absent unless an admin asked and the payload could be read */
    qa?: LiveQaBadge
}

/**
 * A scoreboard event one of the player's teams is playing, as a game-log row.
 *
 * The log comes from the Data API, which holds PROCESSED FINALS -- so the game
 * he is playing right now has no row, and a badge on the rows that do exist can
 * never fire (review on #268). The row is synthesized from the scoreboard event
 * instead: opponent, kickoff, week and the live score, with every stat cell
 * empty because no play of it has been processed yet. When the processor lands
 * the final, the API's own row takes its place -- same `game_id`, so it is
 * swapped, never duplicated.
 */
export function liveGameRow(event: ESPNScheduleEvent, teamIds: Set<string>): PlayerGameRow | null {
    const comp = event.competitions?.[0];
    const mine = comp?.competitors?.find((c) => teamIds.has(String(c.team?.id ?? '')));
    const them = comp?.competitors?.find((c) => c !== mine);
    if (!mine || !them) return null;
    return {
        from_scoreboard: true,
        game_id: String(event.id),
        season: Number(event.season?.year) || undefined,
        week: event.week?.number ?? null,
        season_type: String(event.season?.type ?? ''),
        game_date: comp?.date ?? event.date ?? null,
        team_id: String(mine.team?.id ?? ''),
        opponent_id: String(them.team?.id ?? ''),
        // the scoreboard's short name, which is what the API's own rows carry
        opponent: them.team?.shortDisplayName ?? them.team?.displayName ?? null,
        home_away: mine.homeAway ?? null,
        team_score: numberOrNull(mine.score),
        opponent_score: numberOrNull(them.score),
        result: null,
    };
}

/** A game log plus what may be said about the game in it that is in progress. */
export interface LivePlayerGames {
    /** ESPN event id -> the live claim, and (admin only) the QA verdict */
    live: Record<string, LiveGameStatus>
    /** the rows to render: the API's, with a synthetic row on top for a live game */
    games: PlayerGameRow[]
}

/**
 * The game log to render, and the in-progress games in it.
 *
 * Cheap by construction: a past season can have no live game, so it never
 * leaves this function; the current season costs one KV-cached scoreboard read.
 * The processed-game read happens ONLY for an admin, and then only for a live
 * game -- at most one for a player -- on the game page's own cache key, so it
 * is the processing run the game page would do anyway and never a second one.
 * Every hop fails open, because a badge is never worth a blank page.
 */
export async function livePlayerGames(
    games: PlayerGameRow[], espnGameIds: Record<string, string>, teamIds: (string | number)[],
    season: number, league: League, withQa: boolean = false,
): Promise<LivePlayerGames> {
    const none: LivePlayerGames = { live: {}, games };
    if (season !== CURRENT_YEAR) return none;
    let board: ESPNScheduleEvent[];
    try {
        board = (await getCurrentScoreboard(true, false, league)).filter(inProgress);
    } catch {
        return none; // no scoreboard, no live claim
    }
    const liveIds = new Set(board.map((g) => String(g.id)));
    const logged = new Set(games.map((g) => espnGameId(g, espnGameIds)).filter(Boolean) as string[]);
    // At most one: a team plays one game at a time, and a traded player's other
    // team is not playing this one.
    const mine = new Set(teamIds.map(String).filter((id) => id !== ''));
    const extra = mine.size === 0 ? null : (board
        .filter((e) => !logged.has(String(e.id)))
        .map((e) => liveGameRow(e, mine))
        .find(Boolean) ?? null);

    const ids = [...logged].filter((id) => liveIds.has(id));
    if (extra) ids.push(String(extra.game_id));
    const out: Record<string, LiveGameStatus> = {};
    for (const id of ids) out[id] = { live: true };
    const rows = extra ? [extra, ...games] : games;
    if (!withQa || ids.length === 0) return { live: out, games: rows };
    await Promise.all(ids.map(async (id) => {
        try {
            // the game page's live-game maxAge; the cache KEY is TTL-independent
            // (`.../process?v=<APP_VERSION>`), so this shares its entry.
            out[id].qa = qaBadge(await retrieveProcessedGame(id, CURRENT_SEASON_CONFIG.liveGameRefreshRate, league));
        } catch (e) {
            console.warn(`live badge: no processed payload for ${league} ${id}: ${e}`);
        }
    }));
    return { live: out, games: rows };
}
