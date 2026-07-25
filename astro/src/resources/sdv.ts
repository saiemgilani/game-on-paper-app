import { getSecret } from "astro:env/server";
import { cleanUpParams } from "../utils/misc";
import type { PercentileRequest, SeasonPercentile } from "./summary";

const SDV_HTTP_URL = 'https://data.sportsdataverse.org/v1/cfb/';
const SDV_AUTH_TOKEN = getSecret("SDV_AUTH_TOKEN")

async function requestSDV(endpoint: string, query?: URLSearchParams, body?: URLSearchParams): Promise<any> {
    if (!SDV_AUTH_TOKEN) {
        throw Error("SDV_AUTH_TOKEN not set, can not fire request")
    }

    let baseURL = `${SDV_HTTP_URL}/${endpoint}`
    if (query && (query?.size || 0) > 0) {
        baseURL += `?${query.toString()}`
    }

    const config: RequestInit = {
        headers: {
            "Authorization": `Bearer ${SDV_AUTH_TOKEN}`
        },
        body
    }

    return await fetch(baseURL, config)
}

async function retrieveRemotePercentiles(payload: PercentileRequest, maxLookback = 2014): Promise<SeasonPercentile[]> {
    if (!payload.year && !payload.pctile) {
        // logger.error(`failed to retreive percentiles, must provide 'year' AND/OR 'pctile'`)
        return [];
    }
    try {
        const query = cleanUpParams(payload);
        // const req = await fetch(`${SUMMARY_HTTP_URL}/percentiles?` + (new URLSearchParams(query)).toString());
        
        // // update redis cache
        // const content: any = await req.json();
        // // const key = generateKey(["percentiles", year, pctile]);
        // // expire every three days so that we get fresh data
        // // await lruCache.set(key, JSON.stringify(content), { EX: 60 * 60 * 24 * 3 });
        // return content["results"];

        const req = await requestSDV("percentiles", new URLSearchParams(query));
        const content: any = await req.json();
        console.error(JSON.stringify(content))
        return content["data"];
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

export default {
    // retrieveLastUpdated,
    // retrieveLeagueData,
    retrievePercentiles,
    // retrieveTeamData,
    // retrievePlayerData,
    // retrieveAllTeams,
    // last_updated: await (async () => {
    //     const d = await retrieveLastUpdated()
    //     return DateTime.fromISO(d).toLocaleString(DateTime.DATETIME_SHORT);
    // })()
};