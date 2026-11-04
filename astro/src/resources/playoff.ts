import { getSecret } from "astro:env/server";
import { env } from "cloudflare:workers";
import { retrieveRows, sdvIngestStamp, SDV_RATINGS_PREDICTION_CONFIG } from "./sdv";
import { retrieveRankings } from "./espn";
import { committeeRanking, type CommitteeRanking } from "../utils/playoff";
import { PROCESSOR_VERSION } from "./python";
import { safeCachePut } from "../utils/misc";
import { wrappedFetch } from "../utils/telemetry";

const PYTHON_HTTP_URL = getSecret("PYTHON_HTTP_URL") || 'http://python:5000';
const PYTHON_HTTP_TOKEN = getSecret("PYTHON_HTTP_TOKEN");

// the API answers in ~10 s (1000 sims; sdv-py's tiebreakers dominate)
const PROJECTION_TIMEOUT_MS = 60_000;
// keyed on both inputs' ingest stamps, so a new ingest is a new key; the TTL only bounds a stamp-less key
const PROJECTION_TTL = 60 * 60 * 24 * 2;
const INPUT_TTL = 60 * 60 * 6;
// the committee publishes weekly: ESPN is asked at most hourly, and never waited on for long;
// the last ranking read outlives a week of ESPN trouble
const COMMITTEE_FRESH_MS = 60 * 60 * 1000;
const COMMITTEE_KEEP = 60 * 60 * 24 * 8;
export const RANKINGS_TIMEOUT_MS = 3_000;
// 888 FBS-participant games in 2026 (11-02); a full page would mean a truncated schedule
const SCHEDULE_LIMIT = 5000;

const SCHEDULE_COLUMNS = ['game_id', 'week', 'season_type', 'completed', 'neutral_site', 'home_id', 'home_points', 'away_id', 'away_points'];
const TEAM_COLUMNS = ['team_id', 'pos_team', 'conference', 'net_adj_epa'];

export type PlayoffRound = 'quarterfinal' | 'semifinal' | 'final' | 'champion';

export interface PlayoffSeed {
    seed: number
    team_id: string
    /** a P4 champion, the G6 bid, or Notre Dame inside the top 12 */
    auto: boolean
    /** the chance this seed reaches each round of the fixed bracket */
    reach: Record<PlayoffRound, number>
}

export interface PlayoffTeam {
    team_id: string
    name: string
    conference: string
    rating: number
    /** wins, losses so far */
    record: [number, number]
    /** mean simulated wins and losses, title game included */
    wins: number
    losses: number
    win_out: number
    conf_title: number
    playoff: number
    bye: number
    avg_seed: number | null
    champion: number
}

export interface PlayoffProjection {
    season: number
    sims: number
    loss_penalty: number
    field: PlayoffSeed[]
    last_out: string[]
    teams: PlayoffTeam[]
    /** the committee's field, if the season ended today; null before its first ranking */
    committee?: {
        /** the committee's ranking (FBS ids, No. 1 first) and when it was published */
        ranking: string[]
        date: string
        /** each team's rank as the committee printed it */
        ranks?: Record<string, number>
        field: PlayoffSeed[]
        last_out: string[]
    } | null
}

/** What KV keeps per season: the last ranking read (null: no poll yet) and when ESPN was last asked. */
interface CommitteeCache { at: number, ranking: CommitteeRanking | null }
// one refresh per season per isolate: concurrent cache misses share it
const refreshing = new Map<number, Promise<CommitteeRanking | null>>();

/**
 * The committee's ranking for the season. KV holds the last one read for 8 days; ESPN is asked
 * again only once that read is an hour old, under a short timeout. Every outcome is cached for the
 * hour: a new poll, no poll yet, or a failed/stalled/malformed feed (which keeps the last ranking).
 * So a slow or failing ESPN never drops a bracket the page already had, the page waits on ESPN at
 * most once an hour, and an older poll never replaces a newer one.
 */
async function currentCommittee(season: number): Promise<CommitteeRanking | null> {
    const key = `playoff-committee:v2:${season}`;
    const cached = await env.SDV_API_CACHE.get<CommitteeCache>(key, 'json').catch(() => null);
    if (cached && Date.now() - cached.at < COMMITTEE_FRESH_MS) return cached.ranking;
    let pending = refreshing.get(season);
    if (!pending) {
        pending = refreshCommittee(season, key, cached?.ranking ?? null).finally(() => refreshing.delete(season));
        refreshing.set(season, pending);
    }
    return pending;
}

async function refreshCommittee(season: number, key: string, last: CommitteeRanking | null): Promise<CommitteeRanking | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), RANKINGS_TIMEOUT_MS); });
    const feed = await Promise.race([retrieveRankings().catch(() => null), timeout]);
    clearTimeout(timer);
    let read: CommitteeRanking | null = null;
    try { read = committeeRanking(feed, season); } catch { /* a malformed feed reads as no poll */ }
    // ESPN down or no poll in the answer: keep the last ranking; an older poll never replaces a newer one
    const ranking = !read ? last : (last && last.date > read.date ? last : read);
    await safeCachePut(env.SDV_API_CACHE, key, JSON.stringify({ at: Date.now(), ranking } satisfies CommitteeCache), COMMITTEE_KEEP);
    return ranking;
}

/**
 * The season's CFP projection from the API (python/playoff_projection.py): it simulates the rest
 * of the season with sportsdataverse-py's sims and cfbseedR tiebreakers, priced by the same pregame
 * model as the game page, and applies the 2026 selection rules and fixed bracket. null when any
 * input or the API fails; a failure is never cached.
 */
export async function retrievePlayoffProjection(season: number): Promise<PlayoffProjection | null> {
    const model = SDV_RATINGS_PREDICTION_CONFIG.cfb;
    if (!PYTHON_HTTP_TOKEN || !model) return null;
    const constants = { scale: model.net_points_scale, hfa: model.hfa_points, sd: model.margin_sd };
    try {
        const [scheduleStamp, summaryStamp, committee] = await Promise.all([
            sdvIngestStamp('cfb', 'schedule'), sdvIngestStamp('cfb', 'team_summaries'),
            currentCommittee(season).catch(() => null),
        ]);
        // a refit model is a new projection too, and a new (or corrected, same-date) committee ranking a new bracket
        const committeeKey = committee ? `${committee.date}~${committee.ids.join('.')}` : '-';
        const key = `playoff-projection:${season}:${scheduleStamp ?? '-'}:${summaryStamp ?? '-'}:${PROCESSOR_VERSION}:${Object.values(constants).join(',')}:${committeeKey}`;
        const cached = await env.SDV_API_CACHE.get<PlayoffProjection>(key, 'json');
        if (cached) return cached;
        const [games, teams] = await Promise.all([
            retrieveRows<Record<string, unknown>>('cfb', 'schedule', { season: String(season), fbs_participant: 'true', limit: String(SCHEDULE_LIMIT), select: SCHEDULE_COLUMNS.join(',') }, INPUT_TTL, true),
            retrieveRows<Record<string, unknown>>('cfb', 'team_summaries', { season: String(season), limit: '500', select: TEAM_COLUMNS.join(',') }, INPUT_TTL, true),
        ]);
        // a truncated schedule or an empty rating table would project a different season
        if (games.length === 0 || games.length >= SCHEDULE_LIMIT) throw new Error(`${games.length} schedule rows`);
        if (!teams.some((t) => typeof t.net_adj_epa === 'number')) throw new Error('no net_adj_epa in team_summaries');
        const req = await wrappedFetch(`${PYTHON_HTTP_URL}/cfb/playoff/projection`, {
            method: 'POST',
            headers: { "Authorization": `Bearer ${btoa(PYTHON_HTTP_TOKEN)}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                season,
                games,
                teams,
                model: constants,
                committee: committee?.ids ?? null,
            }),
            signal: AbortSignal.timeout(PROJECTION_TIMEOUT_MS),
        });
        if (!req.ok) throw new Error(`HTTP ${req.status}`);
        const projection = await req.json() as PlayoffProjection;
        if (projection.committee && committee) Object.assign(projection.committee, { date: committee.date, ranks: committee.ranks });
        if (!Array.isArray(projection?.field) || projection.field.length !== 12) throw new Error('no 12-team field in the answer');
        await safeCachePut(env.SDV_API_CACHE, key, JSON.stringify(projection), PROJECTION_TTL);
        return projection;
    } catch (e) {
        console.error(`ERROR while projecting the ${season} playoff: ${e}`);
        return null;
    }
}
