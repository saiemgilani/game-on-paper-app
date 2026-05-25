import scheduleMap from '../static/schedule.json' with { type: "json" };
import groupMap from '../static/groups.json' with { type: "json" };  

export interface ScheduleWeek {
    label: string;
    alternateLabel: string;
    detail: string;
    value: string;
    startDate: string;
    endDate: string;
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



// async function _getRemoteGames(year, week, type, group) {
//     var espnGroup = group; 
//     if (espnGroup && espnGroup < 0) {
//         espnGroup = 80; // All FBS which we will filter
//     }

//     if (year == null || week == null) {
//         const res =  await axios.get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=${espnGroup || 80}&size=100000&${new Date().getTime()}`, {
//             protocol: "https"
//         })
//         // logger.info(res.request.res.responseUrl)
//         let espnContent = res.data;
//         if (espnContent == null) {
//             throw Error(`Data not available for ESPN's schedule endpoint.`)
//         }

//         let result = (espnContent != null) ? espnContent.events : [];

//         if (group == -1) { // top 25
//             result = result.filter(g => {
//                 const home = g.competitions[0].competitors[0];
//                 const away = g.competitions[0].competitors[1];

//                 return ((home.curatedRank?.current ?? 99) < 26) || ((away.curatedRank?.current ?? 99) < 26)
//             })
//         }

//         return result;
//     } else {
//         // https://github.com/BlueSCar/cfb-data/blob/master/app/services/schedule.service.js
//         const baseUrl = 'https://cdn.espn.com/core/college-football/schedule?';

//         let query = {
//             year: year,
//             week: week,
//             group: espnGroup || 80,
//             // type: type || 2,
//             seasontype: type || 2,
//             xhr: 1,
//             render: 'false',
//             userab: 18,
//         }
//         if (week === "999") {
//             query["week"] = null;
//         }

//         query = cleanUpParams(query)
        
//         const url = baseUrl + (new URLSearchParams(query)).toString(); // + `&${new Date().getTime()}`;
//         // logger.info(url)
//         const res = await axios.get(url);

//         let espnContent = res.data;
//         if (espnContent == null) {
//             throw Error(`Data not available for ESPN's schedule endpoint.`)
//         }

//         if (typeof espnContent == 'string' && espnContent.toLocaleLowerCase().includes("<html>")) {
//             throw Error("Data returned from ESPN was HTML file, not valid JSON.")
//         }

//         var result = []
//         const actualContent = espnContent.content?.schedule;
//         if (!actualContent) {
//             throw Error(`Data not available for ESPN's schedule endpoint.`)
//         }
//         Object.entries(actualContent).forEach(([date, schedule]) => {
//             if (schedule != null && schedule.games != null) {
//                 result = result.concat(schedule.games)
//             }
//         })

//         if (group == -1) { // top 25
//             result = result.filter(g => {
//                 const home = g.competitions[0].competitors[0];
//                 const away = g.competitions[0].competitors[1];

//                 return ((home.curatedRank?.current ?? 99) < 26) || ((away.curatedRank?.current ?? 99) < 26)
//             })
//         }

//         return result;
//     }
// }

