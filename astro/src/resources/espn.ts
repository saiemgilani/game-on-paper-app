export interface ESPNScoreboardResponse {
    leagues: ESPNLeague[]
    groups: string[]
    events?: ESPNScheduleEvent[]
    week: { number: number }
}

export interface ESPNScheduleResponse {
    content: ESPNScheduleContent
}

export interface ESPNScheduleContent {
    schedule: { [date: string]: { games: ESPNScheduleEvent[] } }
    league: string
    activeDate: string
    title: string
    description: string
    root: string
    edition: string
    pageTitle: string
    daysToShow: number
    canonical: string
    sport: string
    calendar: ESPNCalendar[]
    weekMap: { number: number }
    og_type: string
}

export interface ESPNLeague {
    id: string
    uid: string
    name: string
    abbreviation: string
    midsizeName: string
    slug: string
    season: ESPNSeason
    calendarType: string
    calendarIsWhitelist: boolean
    calendarStartDate: string
    calendarEndDate: string
    calendar: ESPNCalendar[]
}

export interface ESPNSeason {
    year: number
    startDate: string
    endDate: string
    displayName: string
    type: ESPNSeasonType
}

export interface ESPNSeasonType {
    id: string
    type: number
    name: string
    abbreviation: string
}

export interface ESPNCalendar {
    label: string
    value: string
    startDate: string
    endDate: string
    entries: ESPNScheduleEntry[]
}

export interface ESPNScheduleEntry {
    label: string
    alternateLabel: string
    detail: string
    value: string
    startDate: string
    endDate: string
}

export interface ESPNScheduleEvent {
    id: string
    uid: string
    date: string
    name: string
    shortName: string
    season: { year: number, type: number, slug: string }
    week: { number: number }
    competitions: ESPNCompetition[]
    status: ESPNStatus
}

export interface ESPNCompetition {
    id: string
    uid: string
    date: string
    attendance: number
    type: { id: string, abbreviation: string }
    timeValid: boolean
    dateValid: boolean
    neutralSite: boolean
    conferenceCompetition: boolean
    playByPlayAvailable: boolean
    recent: boolean
    competitors: ESPNCompetitor[]
    status: ESPNStatus
    broadcasts: ESPNBroadcast[]
    format: { regulation: { periods: number } }
    startDate: string
    broadcast: string
    geoBroadcasts: ESPNGeoBroadcast[]
    situation?: ESPNGameSituation
    notes: { type: string, headline: string }[]
}

export interface ESPNGameSituation {
    downDistanceText?: string
    isRedZone?: boolean
    lastPlay?: ESPNPlay
}
export interface ESPNCompetitor {
    id: string
    uid: string
    type: string
    order: number
    homeAway: string
    winner: boolean
    team: ESPNTeam
    score: string
    statistics: any[]
    curatedRank?: { current?: number }
    records: ESPNRecord[]
}

export interface ESPNTeam {
    id: string
    uid: string
    location: string
    name: string
    abbreviation: string
    displayName: string
    shortDisplayName: string
    color: string
    alternateColor?: string
    isActive: boolean
    logo: string
    conferenceId: string
}

export interface ESPNRecord {
    name: string
    abbreviation?: string
    type: string
    summary: string
}

export interface ESPNStatus {
    clock: number
    displayClock: string
    period: number
    type: ESPNStatusType
}

export interface ESPNStatusType {
    id: string
    name: string
    state: string
    completed: boolean
    description: string
    detail: string
    shortDetail: string
}

export interface ESPNBroadcast {
    market: string
    media?: { shortName: string, logo?: string, darkLogo?: string }
    names: string[]
}

export interface ESPNGeoBroadcast {
    type: { id: string, shortName: string }
    market: { id: string, type: string }
    media: { shortName: string, logo?: string, darkLogo?: string }
    lang: string
    region: string
}

export interface ESPNPlay {
    text?: string
    probability?: { awayWinPercentage: number, homeWinPercentage: number }
    end?: {
        team: { id: string }
    }
}

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

