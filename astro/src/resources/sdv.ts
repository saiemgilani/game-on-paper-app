import { getSecret } from "astro:env/server";
import { cleanUpParams } from "../utils/misc";
import { SummaryType, type PercentileRequest, type PlayerSummary, type SeasonPercentile, type SummaryRequest, type SummaryResponse, type TeamSummary } from "./summary";
import { URLSearchParams } from "node:url";
import { SDV_TEAM_METRIC_CATEGORIES } from "../utils/constants";

export interface SDVSummaryResponse {
    data: any[]
    count: number
}

const SDV_HTTP_URL = 'https://data.sportsdataverse.org/v1/cfb';
const SDV_AUTH_TOKEN = getSecret("SDV_AUTH_TOKEN")

async function requestSDV(endpoint: string, query?: URLSearchParams, body?: URLSearchParams): Promise<any> {
    if (!SDV_AUTH_TOKEN) {
        throw Error("SDV_AUTH_TOKEN not set, can not fire request")
    }

    let baseURL = `${SDV_HTTP_URL}/${endpoint}`
    if (query && (query?.size || 0) > 0) {
        baseURL += `?${query.toString()}`
    }
    console.info(baseURL)
    const config: RequestInit = {
        headers: {
            "Authorization": `Bearer ${SDV_AUTH_TOKEN}`
        },
        body
    }

    return await fetch(baseURL, config)
}

async function retrieveRemotePercentiles(season?: number, percentile?: number, maxLookback = 2014): Promise<SeasonPercentile[]> {
    if (!season && !percentile) {
        // logger.error(`failed to retreive percentiles, must provide 'season' AND/OR 'pctile'`)
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
   

        const req = await requestSDV("percentiles", new URLSearchParams(payload));
        const content: any = await req.json();
        // console.error(JSON.stringify(content))
        return content["data"];
    } catch (err) {
        // logger.error(`could not find percentiles (${pctile}) for league in ${year}, checking ${year - 1}`)
        if (err) {
            // logger.error(`also err: ${err}`);
        }
        if (!season) {
            return [];
        } else if ((season >= 2014) && ((season - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveRemotePercentiles(season - 1, percentile, maxLookback);
        }
    }
}

export async function retrievePercentiles(season?: number, percentile?: number, maxLookback = 2014): Promise<SeasonPercentile[]> {
    // console.log(JSON.stringify(payload))
    if (!season && !percentile) {
        // logger.error(`failed to retreive percentiles, must provide 'year' AND/OR 'pctile'`)
        return [];
    }

    // const key = generateKey(["percentiles", year, pctile])
    try {
        // const content = await lruCache.get(key);
        // if (!content) {
        //     throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        // }
        // logger.error(`found content for key ${key}: ${content}`)
        // return JSON.parse(content);
         const content = await retrieveRemotePercentiles(season, percentile, maxLookback);
         return content;
    } catch (err) {
        // logger.error(err)
        // logger.error(`receieved some error from redis for key: ${key}, repulling league data`)
        if (!season) {
            return [];
        } else if ((season >= 2014) && ((season - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveRemotePercentiles(season - 1, percentile, maxLookback);
        }
    }
}

// this needs to be split into players (passing/rushing/receiving) and teams (team_summaries)
export async function retrieveTeamSummaries(season: number, category?: string, team_id?: string | number, maxLookback = 2014): Promise<TeamSummary[]> {
    if (!season) {
        // logger.error(`failed to retreive remote league data, must provide 'year' AND/OR 'type'`)
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
        metric_columns = Object.keys(SDV_TEAM_METRIC_CATEGORIES[category])
    } else if (!category) {
        // not implemented yet
        metric_columns = Object.keys(SDV_TEAM_METRIC_CATEGORIES).flatMap((p: string) => Object.keys(SDV_TEAM_METRIC_CATEGORIES[p]))
    } else {
        throw Error(`Category ${category} not implemented`)
    }
    const category_columns: string[] = metric_columns.concat(metric_columns.map(m => `${m}_rank`))

    payload["select"] = (["pos_team", "team_id", "season", "conference", "division"].concat(category_columns)).join(",");
    payload["limit"] = 150;

    try {        
        // update redis cache
        const req = await requestSDV("team_summaries", new URLSearchParams(payload));
        const content: SDVSummaryResponse = await req.json();
        // console.log(content)
        // const key = generateKey(["league", season, type]);
        // expire every three days so that we get fresh data
        // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 })
        return content.data;
    } catch (err) {
        // logger.error(`could not find data for league in ${season}, checking ${season - 1}`)
        if (err) {
            console.error(`also err: ${err}`);
        }

        if (!season) {
            return [];
        } else if ((season >= 2014) && ((season - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveTeamSummaries((season - 1), category, team_id, maxLookback);
        }
    }
}

async function retrievePlayerSummaries(season: number, type: SummaryType, team_id?: string | number, maxLookback = 2014): Promise<PlayerSummary[]> {
    if (!season && !type) {
        // logger.error(`failed to retreive remote league data, must provide 'year' AND/OR 'type'`)
        return [];
    }

    const payload: Record<string, any> = {};
    if (season) {
        payload["season"] = String(season)
    }

    if (team_id) {
        payload["team_id"] = String(team_id)
    }

    payload["limit"] = 150;

    try {        
        // update redis cache
        let content: SDVSummaryResponse;
        if (type == SummaryType.Passing) {
            content = await requestSDV("passing", new URLSearchParams(payload));
        } else if (type == SummaryType.Rushing) {
            content = await requestSDV("rushing", new URLSearchParams(payload));
        } else if (type == SummaryType.Receiving) {
            content = await requestSDV("receiving", new URLSearchParams(payload));
        } else {
            throw Error(`Type '${type}' not implemented`)
        }
        // const key = generateKey(["league", season, type]);
        // expire every three days so that we get fresh data
        // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 })
        return content.data;
    } catch (err) {
        // logger.error(`could not find data for league in ${season}, checking ${season - 1}`)
        if (err) {
            // logger.error(`also err: ${err}`);
        }

        if (!season) {
            return [];
        } else if ((season >= 2014) && ((season - 1) < maxLookback)) {
            return [];
        } else {
            return await retrievePlayerSummaries((season - 1), type, team_id, maxLookback);
        }
    }
}

export const SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS = [
    "team_id",
    "pos_team",
    "division",
    "conference",
    "season",
    "plays_off",
    "playsgame_off",
    "passrate_off",
    "rushrate_off",
    "havoc_off",
    "explosive_off",
    "TEPA_off",
    "EPAplay_off",
    "EPAdrive_off",
    "EPAgame_off",
    "yards_off",
    "yardsplay_off",
    "yardsgame_off",
    "play_stuffed_off",
    "drives_off",
    "drivesgame_off",
    "yardsdrive_off",
    "playsdrive_off",
    "success_off",
    "red_zone_success_off",
    "third_down_success_off",
    "third_down_distance_off",
    "late_down_success_off",
    "early_down_EPA_off",
    "start_position_off",
    "nonExplosiveEpaPerPlay_off",
    "line_yards_off",
    "opportunity_rate_off",
    "playsgame_off_rank",
    "TEPA_off_rank",
    "EPAgame_off_rank",
    "EPAplay_off_rank",
    "EPAdrive_off_rank",
    "early_down_EPA_off_rank",
    "success_off_rank",
    "yards_off_rank",
    "yardsplay_off_rank",
    "yardsgame_off_rank",
    "drivesgame_off_rank",
    "yardsdrive_off_rank",
    "playsdrive_off_rank",
    "play_stuffed_off_rank",
    "red_zone_success_off_rank",
    "third_down_success_off_rank",
    "late_down_success_off_rank",
    "third_down_distance_off_rank",
    "start_position_off_rank",
    "havoc_off_rank",
    "explosive_off_rank",
    "passrate_off_rank",
    "rushrate_off_rank",
    "nonExplosiveEpaPerPlay_off_rank",
    "line_yards_off_rank",
    "opportunity_rate_off_rank",
    "plays_def",
    "playsgame_def",
    "passrate_def",
    "rushrate_def",
    "havoc_def",
    "explosive_def",
    "TEPA_def",
    "EPAplay_def",
    "EPAdrive_def",
    "EPAgame_def",
    "yards_def",
    "yardsplay_def",
    "yardsgame_def",
    "play_stuffed_def",
    "drives_def",
    "drivesgame_def",
    "yardsdrive_def",
    "playsdrive_def",
    "success_def",
    "red_zone_success_def",
    "third_down_success_def",
    "third_down_distance_def",
    "late_down_success_def",
    "early_down_EPA_def",
    "start_position_def",
    "nonExplosiveEpaPerPlay_def",
    "line_yards_def",
    "opportunity_rate_def",
    "playsgame_def_rank",
    "TEPA_def_rank",
    "EPAgame_def_rank",
    "EPAplay_def_rank",
    "EPAdrive_def_rank",
    "early_down_EPA_def_rank",
    "success_def_rank",
    "yards_def_rank",
    "yardsplay_def_rank",
    "yardsgame_def_rank",
    "drivesgame_def_rank",
    "yardsdrive_def_rank",
    "playsdrive_def_rank",
    "play_stuffed_def_rank",
    "red_zone_success_def_rank",
    "third_down_success_def_rank",
    "late_down_success_def_rank",
    "third_down_distance_def_rank",
    "start_position_def_rank",
    "havoc_def_rank",
    "explosive_def_rank",
    "passrate_def_rank",
    "rushrate_def_rank",
    "nonExplosiveEpaPerPlay_def_rank",
    "line_yards_def_rank",
    "opportunity_rate_def_rank",
    "TEPA_margin",
    "EPAplay_margin",
    "EPAdrive_margin",
    "EPAgame_margin",
    "success_margin",
    "yardsplay_margin",
    "TEPA_margin_rank",
    "EPAgame_margin_rank",
    "EPAdrive_margin_rank",
    "EPAplay_margin_rank",
    "success_margin_rank",
    "yardsplay_margin_rank",
    "start_position_margin",
    "start_position_margin_rank",
    "total_available_yards_off",
    "total_gained_yards_off",
    "available_yards_pct_off",
    "available_yards_pct_off_rank",
    "total_available_yards_def",
    "total_gained_yards_def",
    "available_yards_pct_def",
    "available_yards_pct_def_rank",
    "total_available_yards_margin",
    "total_gained_yards_margin",
    "available_yards_pct_margin",
    "total_available_yards_margin_rank",
    "total_gained_yards_margin_rank",
    "available_yards_pct_margin_rank",
    "plays_off_pass",
    "playsgame_off_pass",
    "passrate_off_pass",
    "rushrate_off_pass",
    "havoc_off_pass",
    "explosive_off_pass",
    "TEPA_off_pass",
    "EPAplay_off_pass",
    "EPAdrive_off_pass",
    "EPAgame_off_pass",
    "yards_off_pass",
    "yardsplay_off_pass",
    "yardsgame_off_pass",
    "play_stuffed_off_pass",
    "drives_off_pass",
    "drivesgame_off_pass",
    "yardsdrive_off_pass",
    "playsdrive_off_pass",
    "success_off_pass",
    "red_zone_success_off_pass",
    "third_down_success_off_pass",
    "third_down_distance_off_pass",
    "late_down_success_off_pass",
    "early_down_EPA_off_pass",
    "nonExplosiveEpaPerPlay_off_pass",
    "line_yards_off_pass",
    "opportunity_rate_off_pass",
    "playsgame_off_pass_rank",
    "TEPA_off_pass_rank",
    "EPAgame_off_pass_rank",
    "EPAplay_off_pass_rank",
    "EPAdrive_off_pass_rank",
    "early_down_EPA_off_pass_rank",
    "success_off_pass_rank",
    "yards_off_pass_rank",
    "yardsplay_off_pass_rank",
    "yardsgame_off_pass_rank",
    "drivesgame_off_pass_rank",
    "yardsdrive_off_pass_rank",
    "playsdrive_off_pass_rank",
    "play_stuffed_off_pass_rank",
    "red_zone_success_off_pass_rank",
    "third_down_success_off_pass_rank",
    "late_down_success_off_pass_rank",
    "third_down_distance_off_pass_rank",
    "havoc_off_pass_rank",
    "explosive_off_pass_rank",
    "passrate_off_pass_rank",
    "rushrate_off_pass_rank",
    "nonExplosiveEpaPerPlay_off_pass_rank",
    "line_yards_off_pass_rank",
    "opportunity_rate_off_pass_rank",
    "plays_def_pass",
    "playsgame_def_pass",
    "passrate_def_pass",
    "rushrate_def_pass",
    "havoc_def_pass",
    "explosive_def_pass",
    "TEPA_def_pass",
    "EPAplay_def_pass",
    "EPAdrive_def_pass",
    "EPAgame_def_pass",
    "yards_def_pass",
    "yardsplay_def_pass",
    "yardsgame_def_pass",
    "play_stuffed_def_pass",
    "drives_def_pass",
    "drivesgame_def_pass",
    "yardsdrive_def_pass",
    "playsdrive_def_pass",
    "success_def_pass",
    "red_zone_success_def_pass",
    "third_down_success_def_pass",
    "third_down_distance_def_pass",
    "late_down_success_def_pass",
    "early_down_EPA_def_pass",
    "nonExplosiveEpaPerPlay_def_pass",
    "line_yards_def_pass",
    "opportunity_rate_def_pass",
    "playsgame_def_pass_rank",
    "TEPA_def_pass_rank",
    "EPAgame_def_pass_rank",
    "EPAplay_def_pass_rank",
    "EPAdrive_def_pass_rank",
    "early_down_EPA_def_pass_rank",
    "success_def_pass_rank",
    "yards_def_pass_rank",
    "yardsplay_def_pass_rank",
    "yardsgame_def_pass_rank",
    "drivesgame_def_pass_rank",
    "yardsdrive_def_pass_rank",
    "playsdrive_def_pass_rank",
    "play_stuffed_def_pass_rank",
    "red_zone_success_def_pass_rank",
    "third_down_success_def_pass_rank",
    "late_down_success_def_pass_rank",
    "third_down_distance_def_pass_rank",
    "havoc_def_pass_rank",
    "explosive_def_pass_rank",
    "passrate_def_pass_rank",
    "rushrate_def_pass_rank",
    "nonExplosiveEpaPerPlay_def_pass_rank",
    "line_yards_def_pass_rank",
    "opportunity_rate_def_pass_rank",
    "TEPA_margin_pass",
    "EPAplay_margin_pass",
    "EPAdrive_margin_pass",
    "EPAgame_margin_pass",
    "success_margin_pass",
    "yardsplay_margin_pass",
    "TEPA_margin_pass_rank",
    "EPAgame_margin_pass_rank",
    "EPAdrive_margin_pass_rank",
    "EPAplay_margin_pass_rank",
    "success_margin_pass_rank",
    "yardsplay_margin_pass_rank",
    "plays_off_rush",
    "playsgame_off_rush",
    "passrate_off_rush",
    "rushrate_off_rush",
    "havoc_off_rush",
    "explosive_off_rush",
    "TEPA_off_rush",
    "EPAplay_off_rush",
    "EPAdrive_off_rush",
    "EPAgame_off_rush",
    "yards_off_rush",
    "yardsplay_off_rush",
    "yardsgame_off_rush",
    "play_stuffed_off_rush",
    "drives_off_rush",
    "drivesgame_off_rush",
    "yardsdrive_off_rush",
    "playsdrive_off_rush",
    "success_off_rush",
    "red_zone_success_off_rush",
    "third_down_success_off_rush",
    "third_down_distance_off_rush",
    "late_down_success_off_rush",
    "early_down_EPA_off_rush",
    "nonExplosiveEpaPerPlay_off_rush",
    "line_yards_off_rush",
    "opportunity_rate_off_rush",
    "playsgame_off_rush_rank",
    "TEPA_off_rush_rank",
    "EPAgame_off_rush_rank",
    "EPAplay_off_rush_rank",
    "EPAdrive_off_rush_rank",
    "early_down_EPA_off_rush_rank",
    "success_off_rush_rank",
    "yards_off_rush_rank",
    "yardsplay_off_rush_rank",
    "yardsgame_off_rush_rank",
    "drivesgame_off_rush_rank",
    "yardsdrive_off_rush_rank",
    "playsdrive_off_rush_rank",
    "play_stuffed_off_rush_rank",
    "red_zone_success_off_rush_rank",
    "third_down_success_off_rush_rank",
    "late_down_success_off_rush_rank",
    "third_down_distance_off_rush_rank",
    "havoc_off_rush_rank",
    "explosive_off_rush_rank",
    "passrate_off_rush_rank",
    "rushrate_off_rush_rank",
    "nonExplosiveEpaPerPlay_off_rush_rank",
    "line_yards_off_rush_rank",
    "opportunity_rate_off_rush_rank",
    "plays_def_rush",
    "playsgame_def_rush",
    "passrate_def_rush",
    "rushrate_def_rush",
    "havoc_def_rush",
    "explosive_def_rush",
    "TEPA_def_rush",
    "EPAplay_def_rush",
    "EPAdrive_def_rush",
    "EPAgame_def_rush",
    "yards_def_rush",
    "yardsplay_def_rush",
    "yardsgame_def_rush",
    "play_stuffed_def_rush",
    "drives_def_rush",
    "drivesgame_def_rush",
    "yardsdrive_def_rush",
    "playsdrive_def_rush",
    "success_def_rush",
    "red_zone_success_def_rush",
    "third_down_success_def_rush",
    "third_down_distance_def_rush",
    "late_down_success_def_rush",
    "early_down_EPA_def_rush",
    "nonExplosiveEpaPerPlay_def_rush",
    "line_yards_def_rush",
    "opportunity_rate_def_rush",
    "playsgame_def_rush_rank",
    "TEPA_def_rush_rank",
    "EPAgame_def_rush_rank",
    "EPAplay_def_rush_rank",
    "EPAdrive_def_rush_rank",
    "early_down_EPA_def_rush_rank",
    "success_def_rush_rank",
    "yards_def_rush_rank",
    "yardsplay_def_rush_rank",
    "yardsgame_def_rush_rank",
    "drivesgame_def_rush_rank",
    "yardsdrive_def_rush_rank",
    "playsdrive_def_rush_rank",
    "play_stuffed_def_rush_rank",
    "red_zone_success_def_rush_rank",
    "third_down_success_def_rush_rank",
    "late_down_success_def_rush_rank",
    "third_down_distance_def_rush_rank",
    "havoc_def_rush_rank",
    "explosive_def_rush_rank",
    "passrate_def_rush_rank",
    "rushrate_def_rush_rank",
    "nonExplosiveEpaPerPlay_def_rush_rank",
    "line_yards_def_rush_rank",
    "opportunity_rate_def_rush_rank",
    "TEPA_margin_rush",
    "EPAplay_margin_rush",
    "EPAdrive_margin_rush",
    "EPAgame_margin_rush",
    "success_margin_rush",
    "yardsplay_margin_rush",
    "TEPA_margin_rush_rank",
    "EPAgame_margin_rush_rank",
    "EPAdrive_margin_rush_rank",
    "EPAplay_margin_rush_rank",
    "success_margin_rush_rank",
    "yardsplay_margin_rush_rank",
    "fbs_class",
    "valid_games",
    "adj_off_epa",
    "adj_def_epa",
    "def_strength_faced",
    "off_strength_faced",
    "net_adj_epa",
    "adj_off_epa_rank",
    "adj_def_epa_rank",
    "net_adj_epa_rank",
]