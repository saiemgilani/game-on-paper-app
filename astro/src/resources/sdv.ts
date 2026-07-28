import { getSecret } from "astro:env/server";
import { SummaryType } from "./summary";
import { URLSearchParams } from "node:url";
import { SDV_RADAR_COLUMNS, SDV_TEAM_CARD_COLUMNS, SDV_TEAM_METRIC_CATEGORIES } from "../utils/constants";
import { env } from "cloudflare:workers";

export interface SDVSummaryResponse {
    data: any[]
    count: number
}

export interface SDVTeamSummary {
    team_id: string
    pos_team: string
    division: string
    conference: string
    season: number
    plays_off?: number
    playsgame_off?: number
    passrate_off?: number
    rushrate_off?: number
    havoc_off?: number
    explosive_off?: number
    TEPA_off?: number
    EPAplay_off?: number
    EPAdrive_off?: number
    EPAgame_off?: number
    yards_off?: number
    yardsplay_off?: number
    yardsgame_off?: number
    play_stuffed_off?: number
    drives_off?: number
    drivesgame_off?: number
    yardsdrive_off?: number
    playsdrive_off?: number
    success_off?: number
    red_zone_success_off?: number
    third_down_success_off?: number
    third_down_distance_off?: number
    late_down_success_off?: number
    early_down_EPA_off?: number
    start_position_off?: number
    nonExplosiveEpaPerPlay_off?: number
    line_yards_off?: number
    opportunity_rate_off?: number
    playsgame_off_rank?: number
    TEPA_off_rank?: number
    EPAgame_off_rank?: number
    EPAplay_off_rank?: number
    EPAdrive_off_rank?: number
    early_down_EPA_off_rank?: number
    success_off_rank?: number
    yards_off_rank?: number
    yardsplay_off_rank?: number
    yardsgame_off_rank?: number
    drivesgame_off_rank?: number
    yardsdrive_off_rank?: number
    playsdrive_off_rank?: number
    play_stuffed_off_rank?: number
    red_zone_success_off_rank?: number
    third_down_success_off_rank?: number
    late_down_success_off_rank?: number
    third_down_distance_off_rank?: number
    start_position_off_rank?: number
    havoc_off_rank?: number
    explosive_off_rank?: number
    passrate_off_rank?: number
    rushrate_off_rank?: number
    nonExplosiveEpaPerPlay_off_rank?: number
    line_yards_off_rank?: number
    opportunity_rate_off_rank?: number
    plays_def?: number
    playsgame_def?: number
    passrate_def?: number
    rushrate_def?: number
    havoc_def?: number
    explosive_def?: number
    TEPA_def?: number
    EPAplay_def?: number
    EPAdrive_def?: number
    EPAgame_def?: number
    yards_def?: number
    yardsplay_def?: number
    yardsgame_def?: number
    play_stuffed_def?: number
    drives_def?: number
    drivesgame_def?: number
    yardsdrive_def?: number
    playsdrive_def?: number
    success_def?: number
    red_zone_success_def?: number
    third_down_success_def?: number
    third_down_distance_def?: number
    late_down_success_def?: number
    early_down_EPA_def?: number
    start_position_def?: number
    nonExplosiveEpaPerPlay_def?: number
    line_yards_def?: number
    opportunity_rate_def?: number
    playsgame_def_rank?: number
    TEPA_def_rank?: number
    EPAgame_def_rank?: number
    EPAplay_def_rank?: number
    EPAdrive_def_rank?: number
    early_down_EPA_def_rank?: number
    success_def_rank?: number
    yards_def_rank?: number
    yardsplay_def_rank?: number
    yardsgame_def_rank?: number
    drivesgame_def_rank?: number
    yardsdrive_def_rank?: number
    playsdrive_def_rank?: number
    play_stuffed_def_rank?: number
    red_zone_success_def_rank?: number
    third_down_success_def_rank?: number
    late_down_success_def_rank?: number
    third_down_distance_def_rank?: number
    start_position_def_rank?: number
    havoc_def_rank?: number
    explosive_def_rank?: number
    passrate_def_rank?: number
    rushrate_def_rank?: number
    nonExplosiveEpaPerPlay_def_rank?: number
    line_yards_def_rank?: number
    opportunity_rate_def_rank?: number
    TEPA_margin?: number
    EPAplay_margin?: number
    EPAdrive_margin?: number
    EPAgame_margin?: number
    success_margin?: number
    yardsplay_margin?: number
    TEPA_margin_rank?: number
    EPAgame_margin_rank?: number
    EPAdrive_margin_rank?: number
    EPAplay_margin_rank?: number
    success_margin_rank?: number
    yardsplay_margin_rank?: number
    start_position_margin?: number
    start_position_margin_rank?: number
    total_available_yards_off?: number
    total_gained_yards_off?: number
    available_yards_pct_off?: number
    available_yards_pct_off_rank?: number
    total_available_yards_def?: number
    total_gained_yards_def?: number
    available_yards_pct_def?: number
    available_yards_pct_def_rank?: number
    total_available_yards_margin?: number
    total_gained_yards_margin?: number
    available_yards_pct_margin?: number
    total_available_yards_margin_rank?: number
    total_gained_yards_margin_rank?: number
    available_yards_pct_margin_rank?: number
    plays_off_pass?: number
    playsgame_off_pass?: number
    passrate_off_pass?: number
    rushrate_off_pass?: number
    havoc_off_pass?: number
    explosive_off_pass?: number
    TEPA_off_pass?: number
    EPAplay_off_pass?: number
    EPAdrive_off_pass?: number
    EPAgame_off_pass?: number
    yards_off_pass?: number
    yardsplay_off_pass?: number
    yardsgame_off_pass?: number
    play_stuffed_off_pass?: number
    drives_off_pass?: number
    drivesgame_off_pass?: number
    yardsdrive_off_pass?: number
    playsdrive_off_pass?: number
    success_off_pass?: number
    red_zone_success_off_pass?: number
    third_down_success_off_pass?: number
    third_down_distance_off_pass?: number
    late_down_success_off_pass?: number
    early_down_EPA_off_pass?: number
    nonExplosiveEpaPerPlay_off_pass?: number
    line_yards_off_pass?: number
    opportunity_rate_off_pass?: number
    playsgame_off_pass_rank?: number
    TEPA_off_pass_rank?: number
    EPAgame_off_pass_rank?: number
    EPAplay_off_pass_rank?: number
    EPAdrive_off_pass_rank?: number
    early_down_EPA_off_pass_rank?: number
    success_off_pass_rank?: number
    yards_off_pass_rank?: number
    yardsplay_off_pass_rank?: number
    yardsgame_off_pass_rank?: number
    drivesgame_off_pass_rank?: number
    yardsdrive_off_pass_rank?: number
    playsdrive_off_pass_rank?: number
    play_stuffed_off_pass_rank?: number
    red_zone_success_off_pass_rank?: number
    third_down_success_off_pass_rank?: number
    late_down_success_off_pass_rank?: number
    third_down_distance_off_pass_rank?: number
    havoc_off_pass_rank?: number
    explosive_off_pass_rank?: number
    passrate_off_pass_rank?: number
    rushrate_off_pass_rank?: number
    nonExplosiveEpaPerPlay_off_pass_rank?: number
    line_yards_off_pass_rank?: number
    opportunity_rate_off_pass_rank?: number
    plays_def_pass?: number
    playsgame_def_pass?: number
    passrate_def_pass?: number
    rushrate_def_pass?: number
    havoc_def_pass?: number
    explosive_def_pass?: number
    TEPA_def_pass?: number
    EPAplay_def_pass?: number
    EPAdrive_def_pass?: number
    EPAgame_def_pass?: number
    yards_def_pass?: number
    yardsplay_def_pass?: number
    yardsgame_def_pass?: number
    play_stuffed_def_pass?: number
    drives_def_pass?: number
    drivesgame_def_pass?: number
    yardsdrive_def_pass?: number
    playsdrive_def_pass?: number
    success_def_pass?: number
    red_zone_success_def_pass?: number
    third_down_success_def_pass?: number
    third_down_distance_def_pass?: number
    late_down_success_def_pass?: number
    early_down_EPA_def_pass?: number
    nonExplosiveEpaPerPlay_def_pass?: number
    line_yards_def_pass?: number
    opportunity_rate_def_pass?: number
    playsgame_def_pass_rank?: number
    TEPA_def_pass_rank?: number
    EPAgame_def_pass_rank?: number
    EPAplay_def_pass_rank?: number
    EPAdrive_def_pass_rank?: number
    early_down_EPA_def_pass_rank?: number
    success_def_pass_rank?: number
    yards_def_pass_rank?: number
    yardsplay_def_pass_rank?: number
    yardsgame_def_pass_rank?: number
    drivesgame_def_pass_rank?: number
    yardsdrive_def_pass_rank?: number
    playsdrive_def_pass_rank?: number
    play_stuffed_def_pass_rank?: number
    red_zone_success_def_pass_rank?: number
    third_down_success_def_pass_rank?: number
    late_down_success_def_pass_rank?: number
    third_down_distance_def_pass_rank?: number
    havoc_def_pass_rank?: number
    explosive_def_pass_rank?: number
    passrate_def_pass_rank?: number
    rushrate_def_pass_rank?: number
    nonExplosiveEpaPerPlay_def_pass_rank?: number
    line_yards_def_pass_rank?: number
    opportunity_rate_def_pass_rank?: number
    TEPA_margin_pass?: number
    EPAplay_margin_pass?: number
    EPAdrive_margin_pass?: number
    EPAgame_margin_pass?: number
    success_margin_pass?: number
    yardsplay_margin_pass?: number
    TEPA_margin_pass_rank?: number
    EPAgame_margin_pass_rank?: number
    EPAdrive_margin_pass_rank?: number
    EPAplay_margin_pass_rank?: number
    success_margin_pass_rank?: number
    yardsplay_margin_pass_rank?: number
    plays_off_rush?: number
    playsgame_off_rush?: number
    passrate_off_rush?: number
    rushrate_off_rush?: number
    havoc_off_rush?: number
    explosive_off_rush?: number
    TEPA_off_rush?: number
    EPAplay_off_rush?: number
    EPAdrive_off_rush?: number
    EPAgame_off_rush?: number
    yards_off_rush?: number
    yardsplay_off_rush?: number
    yardsgame_off_rush?: number
    play_stuffed_off_rush?: number
    drives_off_rush?: number
    drivesgame_off_rush?: number
    yardsdrive_off_rush?: number
    playsdrive_off_rush?: number
    success_off_rush?: number
    red_zone_success_off_rush?: number
    third_down_success_off_rush?: number
    third_down_distance_off_rush?: number
    late_down_success_off_rush?: number
    early_down_EPA_off_rush?: number
    nonExplosiveEpaPerPlay_off_rush?: number
    line_yards_off_rush?: number
    opportunity_rate_off_rush?: number
    playsgame_off_rush_rank?: number
    TEPA_off_rush_rank?: number
    EPAgame_off_rush_rank?: number
    EPAplay_off_rush_rank?: number
    EPAdrive_off_rush_rank?: number
    early_down_EPA_off_rush_rank?: number
    success_off_rush_rank?: number
    yards_off_rush_rank?: number
    yardsplay_off_rush_rank?: number
    yardsgame_off_rush_rank?: number
    drivesgame_off_rush_rank?: number
    yardsdrive_off_rush_rank?: number
    playsdrive_off_rush_rank?: number
    play_stuffed_off_rush_rank?: number
    red_zone_success_off_rush_rank?: number
    third_down_success_off_rush_rank?: number
    late_down_success_off_rush_rank?: number
    third_down_distance_off_rush_rank?: number
    havoc_off_rush_rank?: number
    explosive_off_rush_rank?: number
    passrate_off_rush_rank?: number
    rushrate_off_rush_rank?: number
    nonExplosiveEpaPerPlay_off_rush_rank?: number
    line_yards_off_rush_rank?: number
    opportunity_rate_off_rush_rank?: number
    plays_def_rush?: number
    playsgame_def_rush?: number
    passrate_def_rush?: number
    rushrate_def_rush?: number
    havoc_def_rush?: number
    explosive_def_rush?: number
    TEPA_def_rush?: number
    EPAplay_def_rush?: number
    EPAdrive_def_rush?: number
    EPAgame_def_rush?: number
    yards_def_rush?: number
    yardsplay_def_rush?: number
    yardsgame_def_rush?: number
    play_stuffed_def_rush?: number
    drives_def_rush?: number
    drivesgame_def_rush?: number
    yardsdrive_def_rush?: number
    playsdrive_def_rush?: number
    success_def_rush?: number
    red_zone_success_def_rush?: number
    third_down_success_def_rush?: number
    third_down_distance_def_rush?: number
    late_down_success_def_rush?: number
    early_down_EPA_def_rush?: number
    nonExplosiveEpaPerPlay_def_rush?: number
    line_yards_def_rush?: number
    opportunity_rate_def_rush?: number
    playsgame_def_rush_rank?: number
    TEPA_def_rush_rank?: number
    EPAgame_def_rush_rank?: number
    EPAplay_def_rush_rank?: number
    EPAdrive_def_rush_rank?: number
    early_down_EPA_def_rush_rank?: number
    success_def_rush_rank?: number
    yards_def_rush_rank?: number
    yardsplay_def_rush_rank?: number
    yardsgame_def_rush_rank?: number
    drivesgame_def_rush_rank?: number
    yardsdrive_def_rush_rank?: number
    playsdrive_def_rush_rank?: number
    play_stuffed_def_rush_rank?: number
    red_zone_success_def_rush_rank?: number
    third_down_success_def_rush_rank?: number
    late_down_success_def_rush_rank?: number
    third_down_distance_def_rush_rank?: number
    havoc_def_rush_rank?: number
    explosive_def_rush_rank?: number
    passrate_def_rush_rank?: number
    rushrate_def_rush_rank?: number
    nonExplosiveEpaPerPlay_def_rush_rank?: number
    line_yards_def_rush_rank?: number
    opportunity_rate_def_rush_rank?: number
    TEPA_margin_rush?: number
    EPAplay_margin_rush?: number
    EPAdrive_margin_rush?: number
    EPAgame_margin_rush?: number
    success_margin_rush?: number
    yardsplay_margin_rush?: number
    TEPA_margin_rush_rank?: number
    EPAgame_margin_rush_rank?: number
    EPAdrive_margin_rush_rank?: number
    EPAplay_margin_rush_rank?: number
    success_margin_rush_rank?: number
    yardsplay_margin_rush_rank?: number
    fbs_class: string
    valid_games?: number
    adj_off_epa?: number
    adj_def_epa?: number
    def_strength_faced?: number
    off_strength_faced?: number
    net_adj_epa?: number
    adj_off_epa_rank?: number
    adj_def_epa_rank?: number
    net_adj_epa_rank?: number
}

export interface SDVSeasonPercentile {
    season: number
    pctile: number
    GEI: number
    EPAplay: number
    pass_success: number
    rush_success: number
    early_down_success: number
    early_down_EPA: number
    late_down_success: number
    success: number
    yardsplay: number
    dropbacks: number
    rushes: number
    EPAdropback: number
    EPArush: number
    yardsdropback: number
    pass_explosive: number
    rush_explosive: number
    explosive: number
    third_down_success: number
    red_zone_success: number
    play_stuffed: number
    nonExplosiveEpaPerPlay: number
    havoc: number
    yardsrush: number
    lineyards: number
    opportunity_run: number
    third_down_distance: number
}

export interface SDVPassingSummary {
    team_id: string
    pos_team: string
    division: string
    conference: string
    season: number
    player_id: number
    passer_player_name: string
    plays: number
    games: number
    team_games: number
    playsgame: number
    TEPA: number
    EPAplay: number
    EPAgame: number
    yards: number
    yardsplay: number
    yardsgame: number
    success: number
    comp: number
    att: number
    comppct: number
    passing_td: number
    sacked: number
    sack_yds: number
    pass_int: number
    detmer: number
    detmergame: number
    dropbacks: number
    sack_adj_yards: number
    yardsdropback: number
    TEPA_rank?: number
    EPAgame_rank?: number
    EPAplay_rank?: number
    success_rank?: number
    comppct_rank?: number
    yards_rank?: number
    yardsplay_rank?: number
    yardsgame_rank?: number
    sack_adj_yards_rank?: number
    yardsdropback_rank?: number
    detmer_rank?: number
    detmergame_rank?: number
    fbs_class: string
}

export interface SDVRushingSummary {
    team_id: string
    pos_team: string
    division: string
    conference: string
    season: number
    player_id: number
    rusher_player_name: string
    plays: number
    games: number
    team_games: number
    playsgame: number
    TEPA: number
    EPAplay: number
    EPAgame: number
    yards: number
    yardsplay: number
    yardsgame: number
    success: number
    rushing_td: number
    fumbles: number
    TEPA_rank: number
    EPAgame_rank: number
    EPAplay_rank: number
    success_rank: number
    yards_rank: number
    yardsplay_rank: number
    yardsgame_rank: number
    fbs_class: string
}

export interface SDVReceivingSummary {
    team_id: string
    pos_team: string
    division: string
    conference: string
    season: number
    player_id: number
    receiver_player_name: string
    plays: number
    games: number
    team_games: number
    playsgame: number
    TEPA: number
    EPAplay: number
    EPAgame: number
    yards: number
    yardsplay: number
    yardsgame: number
    success: number
    comp: number
    targets: number
    catchpct: number
    passing_td: number
    fumbles: number
    TEPA_rank: number
    EPAgame_rank: number
    EPAplay_rank: number
    success_rank: number
    catchpct_rank: number
    yards_rank: number
    yardsplay_rank: number
    yardsgame_rank: number
    fbs_class: string
}

export type SDVPlayerSummary = SDVPassingSummary | SDVReceivingSummary | SDVRushingSummary;

const SDV_HTTP_URL = 'https://data.sportsdataverse.org/v1/cfb';
const SDV_AUTH_TOKEN = getSecret("SDV_AUTH_TOKEN")

async function requestSDV(endpoint: string, query?: URLSearchParams, body?: URLSearchParams, cacheTTL = 60, cacheEnabled = true): Promise<any> {
    if (!SDV_AUTH_TOKEN) {
        throw Error("SDV_AUTH_TOKEN not set, can not fire request")
    }

    let endpointURL = `${endpoint}`
    if (query && (query?.size || 0) > 0) {
        endpointURL += `?${query.toString()}`
    }
    // console.info(baseURL)

    // check cache first
    if (cacheEnabled) { 
        const cachedContent = await env.SDV_API_CACHE.get(endpointURL, "json");
        if (cachedContent) {
            console.info(`SDV API cache hit: ${endpointURL}`)
            return cachedContent
        }
    }

    console.info(`cache miss: ${endpointURL}`)
    const config: RequestInit = {
        headers: {
            "Authorization": `Bearer ${SDV_AUTH_TOKEN}`
        },
        body
    }
    try {
        console.info(`SDV API live request: ${SDV_HTTP_URL}/${endpointURL}`)
        const req = await fetch(`${SDV_HTTP_URL}/${endpointURL}`, config);
        const content: any = await req.json();
        if (content && cacheEnabled) {
            console.info(`SDV API cache update: ${endpointURL}`)
            await env.SDV_API_CACHE.put(endpointURL, content, { expirationTtl: cacheTTL })
        }

        return content;
    } catch (e) {
        console.error(`ERROR while loading data from SDV API endpoint (${endpointURL}): ${e}`)
        return {
            "data": []
        }
    }
}

export async function retrievePercentiles(season?: number, percentile?: number, maxLookback = 2014): Promise<SDVSeasonPercentile[]> {
    if (!season && !percentile) {
        console.error(`failed to retreive percentiles, must provide 'season' AND/OR 'pctile'`)
        return [];
    }
    try {
        const payload: Record<string, any> = {};
        // not a supported param yet
        // if (season) {
        //     payload["season"] = //String(season)
        // }

        if (percentile) {
            payload["pctile"] = percentile
        }
   

        const content = await requestSDV("percentiles", new URLSearchParams(payload), undefined, 60 * 60 * 24 * 7, true);
        return content["data"];
    } catch (err) {
        console.error(`could not find percentiles (${percentile}) for league in ${season}, checking ${(season || 0) - 1}`)
        if (err) {
            console.error(`also err: ${err}`);
        }
        if (!season) {
            return [];
        } else if ((season >= 2014) && ((season - 1) < maxLookback)) {
            return [];
        } else {
            return await retrievePercentiles(season - 1, percentile, maxLookback);
        }
    }
}

// this needs to be split into players (passing/rushing/receiving) and teams (team_summaries)
export async function retrieveTeamSummaries(season?: number, category?: string, team_id?: string | number, maxLookback = 2014): Promise<SDVTeamSummary[]> {
    if (!season && !category && !team_id) {
        console.error(`failed to retreive remote league data, must provide 'year' AND/OR 'type'`)
        return [];
    }

    const payload: Record<string, any> = {};
    if (season) {
        payload["season"] = String(season)
    }

    if (team_id) {
        payload["team_id"] = String(team_id)
    }

    let metric_columns: string[] = []
    if (category) {
        metric_columns = Object.keys(SDV_TEAM_METRIC_CATEGORIES[category]).concat(SDV_RADAR_COLUMNS[category]).concat(SDV_TEAM_CARD_COLUMNS[category])
    } else if (!category) {
        // not implemented yet
        metric_columns = Object.keys(SDV_TEAM_METRIC_CATEGORIES).flatMap((p: string) => Object.keys(SDV_TEAM_METRIC_CATEGORIES[p]).concat(SDV_RADAR_COLUMNS[p]).concat(SDV_TEAM_CARD_COLUMNS[p]))
    } else {
        throw Error(`Category ${category} not implemented`)
    }
    const category_columns: string[] = metric_columns.concat(metric_columns.map(m => `${m}_rank`))

    payload["select"] = (["pos_team", "team_id", "season", "conference", "division"].concat([...new Set(category_columns)])).join(",");
    payload["limit"] = 150;

    try {        
        // update redis cache
        const content: SDVSummaryResponse = await requestSDV("team_summaries", new URLSearchParams(payload), undefined, 60 * 60 * 24 * 3, false);
        // console.log(content)
        // const key = generateKey(["league", season, type]);
        // expire every three days so that we get fresh data
        // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 })
        return content.data;
    } catch (err) {
        console.error(`could not find team summary data from SDV in ${season}, checking ${(season || 0) - 1}`)
        if (err) {
            console.error(`ERROR while loading team summaries from SDV: ${err}`);
            return [];
        } else if (!season) {
            return [];
        } else if ((season >= 2014) && ((season - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveTeamSummaries((season - 1), category, team_id, maxLookback);
        }
    }
}

export async function retrievePlayerSummaries(season: number, category: SummaryType, team_id?: string | number | null, sortBy?: string, ascending: boolean = false, limit: number = 150, maxLookback = 2014): Promise<SDVPlayerSummary[]> {
    if (!season && !category) {
        console.error(`failed to retreive remote league data, must provide 'year' AND/OR 'type'`)
        return [];
    }

    const payload: Record<string, any> = {};
    if (season) {
        payload["season"] = String(season)
    }

    if (team_id) {
        payload["team_id"] = String(team_id)
    }

    if (sortBy) {
        payload["order"] = ((ascending) ? "" : "-") + sortBy
    }

    payload["limit"] = limit;

    try {        
        // update redis cache
        let content: SDVSummaryResponse;
        if (category == SummaryType.Passing) {
            content = await requestSDV("passing", new URLSearchParams(payload), undefined, 60 * 60 * 24 * 3, false);
        } else if (category == SummaryType.Rushing) {
            content = await requestSDV("rushing", new URLSearchParams(payload), undefined, 60 * 60 * 24 * 3, false);
        } else if (category == SummaryType.Receiving) {
            content = await requestSDV("receiving", new URLSearchParams(payload), undefined, 60 * 60 * 24 * 3, false);
        } else {
            throw Error(`Category '${category}' not implemented`)
        }
        // const key = generateKey(["league", season, type]);
        // expire every three days so that we get fresh data
        // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 })
        return content.data;
    } catch (err) {
        console.error(`could not find player summary data from SDV in ${season}, checking ${season - 1}`)
        if (err) {
            console.error(`ERROR while loading player summaries from SDV: ${err}`);
            return [];
        } else if (!season) {
            return [];
        } else if ((season >= 2014) && ((season - 1) < maxLookback)) {
            return [];
        } else {
            return await retrievePlayerSummaries((season - 1), category, team_id, sortBy, ascending, limit, maxLookback);
        }
    }
}