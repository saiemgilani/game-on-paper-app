import scheduleMap from '../static/schedule.json' with { type: "json" };
import groupMap from '../static/groups.json' with { type: "json" };  
import type { ESPNScheduleEntry, ESPNScheduleEvent, ESPNScheduleResponse, ESPNScoreboardResponse } from './game';

export type ScheduleWeek = ESPNScheduleEntry & {
    year: string;
    type: string;
}
export type ScheduleMap = Record<string, ScheduleWeek[]>
export const GLOBAL_SCHEDULE_MAP: ScheduleMap = (scheduleMap as ScheduleMap);

export interface ScheduleGroup {
    id: number;
    name: string;
}
export const GLOBAL_GROUP_LIST: ScheduleGroup[] = (groupMap as ScheduleGroup[]);

export async function getRemoteGames(year?: number, seasontype?: number, week?: number, group?: number): Promise<ESPNScheduleEvent[]> {
    let espnGroup = group;
    if (espnGroup && espnGroup < 0) {
        espnGroup = 80; // All FBS which we will filter
    }

    if (year && week) {
        const baseParams: Record<string, any> = {
            xhr: 1,
            render: false,
            userab: 18
        };
        let query: URLSearchParams = new URLSearchParams(baseParams);
        if (year) {
            query.append("year", `${year}`);
        }
        if (week && week != 999) {
            query.append("week", `${week}`);
        }
        if (espnGroup) {
            query.append("group", `${espnGroup || 80}`);
        }
        if (seasontype) {
            query.append("seasontype", `${seasontype || 2}`);
        }
        
        const resp = await fetch(`https://cdn.espn.com/core/college-football/schedule?${query}`);
        if (!resp.ok) {
            throw new Error(`Response status: ${resp.status}`);
        }

        const espnRaw = await resp.text();
        if (!espnRaw) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }

        if (typeof espnRaw == 'string' && espnRaw.toLocaleLowerCase().includes("<html>")) {
            throw Error("Data returned from ESPN was HTML file, not valid JSON.")
        }

        const espnContent: ESPNScheduleResponse = JSON.parse(espnRaw) as ESPNScheduleResponse;
        var result: any[] = [];
        const actualContent = espnContent?.content?.schedule || {};
        if (!actualContent) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }

        for (const [_, schedule] of Object.entries(actualContent)) {
            if (schedule && Object.keys(schedule).includes("games") && schedule.games) {
                result = result.concat(schedule)
            }
        }

        if (group == -1) { // top 25
            result = result.filter((g: ESPNScheduleEvent) => {
                const home = g.competitions[0].competitors[0];
                const away = g.competitions[0].competitors[1];

                return ((home.curatedRank?.current ?? 99) < 26) || ((away.curatedRank?.current ?? 99) < 26)
            })
        }
        return result;
    } else {
        const resp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${espnGroup || 80}&size=100000&${new Date().getTime()}`)
        let espnContent: ESPNScoreboardResponse = await resp.json();
        if (espnContent == null) {
            throw Error(`Data not available for ESPN's schedule endpoint.`)
        }
        let result = espnContent?.events || [];

        if (group == -1) { // top 25
            result = result.filter((g: ESPNScheduleEvent) => {
                const home = g.competitions[0].competitors[0];
                const away = g.competitions[0].competitors[1];

                return ((home.curatedRank?.current ?? 99) < 26) || ((away.curatedRank?.current ?? 99) < 26)
            })
        }

        return result;
    }
}

