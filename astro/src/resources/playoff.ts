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
// the committee publishes weekly: ESPN is asked at most hourly, and never waited on for long
const COMMITTEE_TTL = 60 * 60;
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

/**
 * The committee's ranking for the season: the last one read (KV, an hour), else ESPN's feed
 * under a short timeout. A slow, throttled or failing ESPN only drops the committee's bracket;
 * the page never waits on it for long, and a cached projection never waits on it at all past
 * the first render of the hour.
 */
async function currentCommittee(season: number): Promise<CommitteeRanking | null> {
    const key = `playoff-committee:${season}`;
    const hit = await env.SDV_API_CACHE.get<CommitteeRanking>(key, 'json').catch(() => null);
    if (hit) return hit;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), RANKINGS_TIMEOUT_MS); });
    const rankings = await Promise.race([retrieveRankings().catch(() => null), timeout]);
    clearTimeout(timer);
    const committee = committeeRanking(rankings, season);
    if (committee) await safeCachePut(env.SDV_API_CACHE, key, JSON.stringify(committee), COMMITTEE_TTL);
    return committee;
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
        // a refit model is a new projection too, and a new committee ranking is a new bracket
        const key = `playoff-projection:${season}:${scheduleStamp ?? '-'}:${summaryStamp ?? '-'}:${PROCESSOR_VERSION}:${Object.values(constants).join(',')}:${committee?.date ?? '-'}`;
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
