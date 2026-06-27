export interface ESPNScoreboardResponse {
    leagues: ESPNLeague[]
    groups: string[]
    events?: ESPNScheduleEvent[]
    week: { number: number }
}

export interface ESPNTeamScheduleResponse {
  timestamp: string
  status: string
  season: ESPNSeason
  team: ESPNTeam
  events: ESPNScheduleEvent[]
  requestedSeason: ESPNRequestedSeason
}

export interface ESPNRequestedSeason {
    year: number
    type: number
    name: string
    displayName: string
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
    status?: ESPNStatus
    timeValid?: boolean
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
    broadcasts?: ESPNBroadcast[]
    format: { regulation: { periods: number } }
    startDate: string
    broadcast: string
    geoBroadcasts?: ESPNGeoBroadcast[]
    situation?: ESPNGameSituation
    notes: { type: string, headline: string }[]

    boxscoreAvailable?: boolean
    commentaryAvailable?: boolean
    liveAvailable?: boolean
    onWatchESPN?: boolean
    wallclockAvailable?: boolean
    boxscoreSource?: string
    playByPlaySource?: string
}

export interface ESPNGameSituation {
    downDistanceText?: string
    isRedZone?: boolean
    lastPlay?: {
        text?: string
        probability?: { awayWinPercentage: number, homeWinPercentage: number }
        end?: {
            team: { id: string }
        }
    }
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

    possession?: boolean
    rank?: number
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
    media?: { shortName: string, logo?: string, darkLogo?: string}
    names: string[]
}

export interface ESPNGeoBroadcast {
    type: { id: string, shortName: string }
    market: { id: string, type: string }
    media: { shortName: string, logo?: string, darkLogo?: string }
    lang: string
    region: string
}

export interface ESPNPlayState {
    down: number
    distance: number
    yardLine: number
    yardsToEndzone: number
    team: { id: number }
    downDistanceText?: string
    shortDownDistanceText?: string
    possessionText?: string
}

export interface ESPNPlayTeamParticipant {
    team: { "$ref": string }
    id: string
    order: number
    type: string
    timeout?: boolean
}

export interface ESPNPlayScoringType {
  name: string
  displayName: string
  abbreviation: string
}

export interface ESPNPlayPointAfterAttempt {
  id: number
  text: string
  abbreviation: string
  value: number
}

export interface ESPNPlay {
    id: string
    type: ESPNPlayType
    clock: ESPNGameClock
    text?: string
    sequenceNumber: string
    awayScore: number
    homeScore: number
    period: { number: number }
    scoringPlay: boolean
    priority: boolean
    modified: string
    wallclock: string
    teamParticipants: ESPNPlayTeamParticipant[]
    isPenalty: boolean
    statYardage: number
    start: ESPNPlayState
    end?: ESPNPlayState
    isTurnover: boolean
    scoringType?: ESPNPlayScoringType
    pointAfterAttempt?: ESPNPlayPointAfterAttempt

    probability?: { awayWinPercentage: number, homeWinPercentage: number }
}

export interface ESPNPlayTeam {
    id: string
    name: string
    abbreviation: string
    displayName: string
    shortDisplayName: string
}

export interface ESPNWinProbability {
    homeWinPercentage: number
    tiePercentage: number
    playId: string
}

export interface ESPNGameHeader {
  id: string
  uid: string
  season: ESPNSeason
  timeValid: boolean
  competitions: ESPNCompetition[]
//   links: Link10[]
  week: number
  league: ESPNLeague
  gameNote: string
}

export interface ESPNGameClock {
    displayValue: string
    minutes?: number
    seconds?: number
}

export interface ESPNPlayType {
    id: number
    text: string
    abbreviation: string
}

export interface ESPNPlayByPlayResponse {
    gameId: number
    gamepackageJSON: {
        header: ESPNGameHeader
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

export async function retrieveGamePage(gameId: string | number): Promise<ESPNPlayByPlayResponse> {
    const cacheBuster = ((new Date()).getTime() * 1000);
    const req = await fetch(`https://cdn.espn.com/core/college-football/playbyplay?gameId=${gameId}&xhr=1&render=false&userab=18&${cacheBuster}`);
    const res: ESPNPlayByPlayResponse = await req.json()
    return res
}

export interface ESPNTeamRequestPayload {
    endpoint?: string
    teamId: string | number
    season?: string | number
    seasonType?: string | number | null
}

async function retrieveTeamEndpoint(payload: ESPNTeamRequestPayload): Promise<any> {
    const endpoint = payload.endpoint ? payload.endpoint : ""
    const seasonType = payload.seasonType != null ? `/types/${payload.seasonType}` : ""
    const seasonStr = payload.season != null ? `/seasons/${payload.season}` : ""
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football${seasonStr}${seasonType}/teams/${payload.teamId}/${endpoint}?lang=en&region=us`
    // console.log(url)
    const req =  await fetch(url);
    const res: any = await req.json()
    return res
}

async function retrieveTeamSchedule(payload: ESPNTeamRequestPayload): Promise<ESPNTeamScheduleResponse> {
    let params = new URLSearchParams({ })
    if (payload.season) {
        params.append("season", `${payload.season}`)
    }
    if (payload.seasonType) {
        params.append("seasontype", `${payload.seasonType}`)
    }
    const reqUrl = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${payload.teamId}/schedule?` + params.toString()
    console.log(reqUrl);
    const req = await fetch(reqUrl);
    const res: ESPNTeamScheduleResponse = await req.json()
    return res
}

export async function retrieveTeamInformation(teamId: string | number): Promise<any> {
    return await retrieveTeamEndpoint({ teamId })
}

export async function retrieveTeamSeasonInformation(season: string | number, teamId: string | number): Promise<any> {
    const seasonInfo = await retrieveTeamEndpoint({ season, teamId })
    const populatableKeys = ["record", "athletes", "ranks", "leaders"];
    const typeKeys = ["record", "leaders"];
    const valPromises: Promise<any>[] = [];
    for (const k of populatableKeys) {
        valPromises.push(retrieveTeamEndpoint({ endpoint: k, season, teamId, seasonType: typeKeys.includes(k) ? "2" : null }))
    }

    const valResults = await Promise.all(valPromises);
    for (const [i, k] of populatableKeys.entries()) {
        seasonInfo[k] = valResults[i]["items"];
    }

    seasonInfo.events = []
    const schedulePromises: Promise<ESPNTeamScheduleResponse>[] = [];
    for (const k of [2, 3]) {
        schedulePromises.push(retrieveTeamSchedule({ season, teamId, seasonType: k }))
    }
    
    const scheduleResults = await Promise.all(schedulePromises);
    for (const sched of scheduleResults) {
        seasonInfo.events = seasonInfo.events.concat(sched.events)
        console.log(seasonInfo.events.length)
    }

    return seasonInfo;
}