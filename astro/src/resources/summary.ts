import { getSecret } from "astro:env/server";
import { cleanUpParams } from "../utils/misc"
import {DateTime} from "luxon";

export interface TeamSummary {
    teamId: number
    team: string
    season: number
    fbsClass: string
    conference: string
    offensive: SituationWrapper<Segment & PlaysSegment & SituationalSuccess>
    defensive: SituationWrapper<Segment & PlaysSegment & SituationalSuccess>
    differential: SituationWrapper<Segment>
}

export interface PlaysSegment {
    totalPlays: number
    playsPerGame: number
    playsPerGameRank: number
}

export interface DrivesSegment {
    totalAvailableYards: number
    totalGainedYards: number
    availableYardsPct: number

    totalAvailableYardsRank: number
    totalGainedYardsRank: number
    availableYardsPctRank: number
}

export interface SituationWrapper<T> {
    overall: T & DrivesSegment
    passing: T
    rushing: T
}

export interface Segment {
    totalEPA: number
    epaPerPlay: number
    adjEpaPerPlay: number
    epaPerDrive: number
    epaPerGame: number
    successRate: number
    startingFP: number
    yards: number
    yardsPerPlay: number
    yardsPerGame: number

    totalEPARank: number
    epaPerPlayRank: number
    adjEpaPerPlayRank: number
    epaPerDriveRank: number
    epaPerGameRank: number
    successRateRank: number
    startingFPRank: number
    yardsRank: number
    yardsPerPlayRank: number
    yardsPerGameRank: number
}

export interface SituationalSuccess {
    stuffedPlayRate: number
    redZoneSuccessRate: number
    thirdDownSuccessRate: number
    thirdDownDistance: number
    lateDownSuccessRate: number
    earlyDownEPAPerPlay: number

    stuffedPlayRateRank: number
    redZoneSuccessRateRank: number
    thirdDownSuccessRateRank: number
    thirdDownDistanceRank: number
    lateDownSuccessRateRank: number
    earlyDownEPAPerPlayRank: number

    havocRate: number
    havocRateRank: number

    explosiveRate: number
    explosiveRateRank: number

    nonExplosiveEpaPerPlay: number
    nonExplosiveEpaPerPlayRank: number
    lineYards: number
    lineYardsRank: number
    opportunityRate: number
    opportunityRateRank: number
}


export interface SeasonPercentile {
    season: number
    pctile: number
    gei: number // GEI
    epaPerPlay: number // EPAplay
    successRate: number // success
    yardsPerPlay: number // yardsplay
    epaPerDropback: number // EPAdropback
    epaPerRush: number // EPArush
    yardsPerDropback: number // yardsdropback
    yardsPerRush: number // yardsrush

    explosivePlayRate: number //explosive
    thirdDownSuccessRate: number // third_down_success
    redZoneSuccessRate: number // red_zone_success

    passingSuccessRate: number
    passingExplosivePlayRate: number //explosive
    rushingSuccessRate: number
    rushingExplosivePlayRate: number //explosive

    playStuffedRate: number // play_stuffed
    havocRate: number //havoc

    lineYards: number
    rushOpportunityRate: number

    nonExplosiveEpaPerPlay: number
    earlyDownEpaPerPlay: number
    earlyDownSuccessRate: number
    lateDownSuccessRate: number
    thirdDownDistance: number
}

export interface PlayerSummary {
    teamId: number
    team: string
    season: number
    name: string
    playerId: string

    advanced: AdvancedPlayerStats
    statistics: PlayerStatistics
}

export type PlayerStatistics = (PassingStats | RushingStats | ReceivingStats) & BasePlayerStats;

export enum SummaryType {
    Overall = 'overall',
    Passing = 'passing',
    Rushing = 'rushing',
    Receiving = 'receiving' 
}

interface BasePlayerStats {
    plays: number
    games: number
    playsPerGame: number
    yards: number
    yardsPerPlay: number
    yardsPerGame: number

    yardsRank: number
    yardsPerPlayRank: number
    yardsPerGameRank: number
}

export interface AdvancedPlayerStats {
    totalEPA: number
    epaPerPlay: number
    epaPerGame: number
    successRate: number

    totalEPARank: number
    epaPerPlayRank: number
    epaPerGameRank: number
    successRateRank: number
}

export interface PassingStats {
    completions: number
    attempts: number
    dropbacks: number
    completionPct: number
    touchdowns: number
    sacks: number
    sackYards: number
    sackAdjustedYards: number
    yardsPerDropback: number

    interceptions: number
    detmer: number
    detmerPerGame: number

    completionPctRank: number
    detmerRank: number
    detmerPerGameRank: number

    sackAdjustedYardsRank: number
    yardsPerDropbackRank: number
}

export interface RushingStats {
    touchdowns: number
    fumbles: number
}

export interface ReceivingStats {
    catches: number
    targets: number
    catchPct: number
    touchdowns: number
    fumbles: number

    catchPctRank: number
}

export interface SummaryRequest {
    year?: number
    team?: string
    type?: SummaryType
}

export interface PercentileRequest {
    year?: number
    pctile?: number // has to be 0.01 to 0.99
}

export interface TeamDataRequest {
    year?: number
    team?: number
    type?: string
}

export interface TeamIndex { 
    team_id: number
    name: string
    seasons: number[]
}

export interface LastUpdatedResponse {
    last_updated: string
}

export interface SummaryResponse {
    results: any[]
}

const SUMMARY_HTTP_URL = getSecret("SUMMARY_HTTP_URL") || 'http://summary:3000';
console.log(SUMMARY_HTTP_URL)

async function retrieveAllTeams(): Promise<TeamIndex[]> {
    try {
        // logger.info(`loading from summary at url: /teams`)
        const req = await fetch(`${SUMMARY_HTTP_URL}/teams`);
        const res: { teams: TeamIndex[] } = await req.json()
        return res.teams;
    } catch (err) {
        // logger.info(`error when loading from summary at url: /teams: ${err}`)
        return [];
    }
}

async function retrieveRemoteData(payload: Record<string, any>): Promise<any[]> {
    const query = cleanUpParams(payload);
    // logger.info(`loading from summary: ${JSON.stringify(query)}`)
    const response = await fetch(`${SUMMARY_HTTP_URL}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(query)
    });
    const content: SummaryResponse = await response.json();
    return content.results;
}

async function retrieveRemoteLeagueData(payload: SummaryRequest, maxLookback = 2014): Promise<TeamSummary[]> {
    if (!payload.year && !payload.type) {
        // logger.error(`failed to retreive remote league data, must provide 'year' AND/OR 'type'`)
        return [];
    }
    try {        
        // update redis cache
        const content = await retrieveRemoteData(payload);
        // const key = generateKey(["league", payload.year, payload.type]);
        // expire every three days so that we get fresh data
        // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 })
        return content;
    } catch (err) {
        // logger.error(`could not find data for league in ${payload.year}, checking ${payload.year - 1}`)
        if (err) {
            // logger.error(`also err: ${err}`);
        }

        if (!payload.year) {
            return [];
        } else if ((payload.year >= 2014) && ((payload.year - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveRemoteLeagueData({year: payload.year - 1, type: payload.type}, maxLookback);
        }
    }
}

async function retrieveLeagueData(payload: SummaryRequest, maxLookback = 2014): Promise<TeamSummary[]> {
    if (!payload.year && !payload.type) {
        // logger.error(`failed to retreive league data, must provide 'year' AND/OR 'type'`)
        return [];
    }
    // const key = generateKey(["league", payload.year, payload.type]);
    // try {
        // const content = await lruCache.get(key);
        // if (!content) {
            // throw new Error(`receieved invalid/empty league data from redis for key: ${key}, repulling`)
        // }
        // logger.info(`found content for key ${key}: ${content}`)
        // return JSON.parse(content);
    // } catch (err) {
        // logger.error(err)
        // logger.error(`receieved some error from redis for key: ${key}, repulling league data`)
        return await retrieveRemoteLeagueData(payload, maxLookback);
    // }
}


async function retrieveRemoteLastUpdated(): Promise<string> {
    const response = await fetch(`${SUMMARY_HTTP_URL}/updated`);
    const content: LastUpdatedResponse = await response.json();
    // expire every three days so that we get fresh data
    // await lruCache.set(`summary-last-updated`, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 });
    return content.last_updated;
}

async function retrieveLastUpdated(): Promise<string>  {
    // try {
    //     const key = `summary-last-updated`;
    //     const content = await lruCache.get(key);
    //     if (!content) {
    //         throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
    //     }
    //     return JSON.parse(content).last_updated;
    // } catch (err) {
    //     logger.error(err)
        return await retrieveRemoteLastUpdated();
    // }
}

async function retrieveRemotePercentiles(payload: PercentileRequest, maxLookback = 2014): Promise<SeasonPercentile[]> {
    if (!payload.year && !payload.pctile) {
        // logger.error(`failed to retreive percentiles, must provide 'year' AND/OR 'pctile'`)
        return [];
    }
    try {
        const query = cleanUpParams(payload);
        const req = await fetch(`${SUMMARY_HTTP_URL}/percentiles?` + (new URLSearchParams(query)).toString());
        
        // update redis cache
        const content = await req.json();
        // const key = generateKey(["percentiles", year, pctile]);
        // expire every three days so that we get fresh data
        // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 });
        return content.results;
    } catch (err) {
        // logger.error(`could not find percentiles (${pctile}) for league in ${year}, checking ${year - 1}`)
        if (err) {
            // logger.error(`also err: ${err}`);
        }
        if (!payload.year) {
            return [];
        } else if ((payload.year >= 2014) && ((payload.year - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveRemotePercentiles({year: payload.year - 1, pctile: payload.pctile }, maxLookback);
        }
    }
}

async function retrievePercentiles(payload: PercentileRequest, maxLookback = 2014): Promise<SeasonPercentile[]> {
    console.log(JSON.stringify(payload))
    if (!payload.year && !payload.pctile) {
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
         const content = await retrieveRemotePercentiles(payload);
         return content;
    } catch (err) {
        // logger.error(err)
        // logger.error(`receieved some error from redis for key: ${key}, repulling league data`)
        if (!payload.year) {
            return [];
        } else if ((payload.year >= 2014) && ((payload.year - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveRemotePercentiles({year: payload.year - 1, pctile: payload.pctile }, maxLookback);
        }
    }
}

async function retrieveRemoteTeamData(payload: TeamDataRequest, maxLookback = 2014): Promise<TeamSummary[]> {
    if (!payload.year && !payload.team) {
        // logger.error(`failed to retreive remote team data, must provide 'year' AND/OR 'team_id'`)
        return [];
    }
    try {
        // update redis cache
        const content = await retrieveRemoteData(payload);
        // const key = generateKey([year, team_id, type]);
        // expire every three days so that we get fresh data
        // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 });
        return content;
    } catch (err) {
        // logger.error(`could not find data for ${team_id} in ${year}, checking ${year - 1}`)
        if (err) {
            // logger.error(`also err: ${err}`);
        }
        if (!payload.year) {
            return []; 
        } else if ((payload.year >= 2014) && ((payload.year - 1) < maxLookback)) {
            return [];
        } else {
            return await retrieveRemoteTeamData({year: payload.year - 1, team: payload.team, type: payload.type }, maxLookback);
        }
    }
}

async function retrieveTeamData(payload: TeamDataRequest, maxLookback = 2014): Promise<TeamSummary[]> {
    // try {
        // let keyParts = []
        // if (payload.year) {
        //     keyParts.push(payload.year)
        // }
        // if (payload.team_id) {
        //     keyParts.push(payload.team_id)
        // }
        // if (keyParts.length == 0) {
        //     throw new Error("invalid team data request, must include year AND/OR team")
        // }
        // if (payload.type) {
        //     keyParts.push(payload.type)
        // }
        // const key = generateKey(keyParts);
        // const content = await lruCache.get(key);
        // if (!content) {
        //     throw new Error(`receieved invalid/empty data from redis for key: ${key}, repulling`)
        // }
        // return JSON.parse(content)
    // } catch (err) {
        // logger.error(err)
    return await retrieveRemoteTeamData(payload, maxLookback);
    // }
}

export default {
    retrieveLastUpdated,
    retrieveLeagueData,
    retrievePercentiles,
    retrieveTeamData,
    retrieveAllTeams,
    last_updated: await (async () => {
        const d = await retrieveLastUpdated()
        return DateTime.fromISO(d).toLocaleString(DateTime.DATETIME_SHORT);
    })()
};