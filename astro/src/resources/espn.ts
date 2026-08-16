import { env } from "cloudflare:workers"
import { safeCachePut, wrappedFetch } from "../utils/misc"
import { CACHE_TTL_MULTIPLIER, CURRENT_SEASON_CONFIG } from "../utils/config"

export interface ESPNCoreScoreboardResponse {
    content: {
        sbData: ESPNScoreboardResponse
    }
}

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

async function requestESPN(url: string, init?: RequestInit): Promise<Response> {
    return await wrappedFetch(
        url, 
        {
            ...init, 
            headers: { 
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15"
            }
        }
    )
}

export async function getRemoteGames(year: number, seasontype?: number, week?: number, group?: number): Promise<ESPNScheduleEvent[]> {
    let espnGroup = group;
    if (espnGroup && espnGroup < 0) {
        espnGroup = 80; // All FBS which we will filter
    }

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
    const reqURL = `https://cdn.espn.com/core/college-football/schedule?` + query.toString()
    console.info(`ESPN schedule query: ${reqURL}`)
    const resp = await requestESPN(reqURL);
    if (!resp.ok) {
        throw new Error(`Response status: ${resp.statusText}`);
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
            result = result.concat(schedule.games)
        }
    }

    if (group == -1) { // top 25
        result = result.filter((g: ESPNScheduleEvent) => {
            const home = g.competitions[0].competitors[0];
            const away = g.competitions[0].competitors[1];

            return ((home.curatedRank?.current ?? 99) < 26) || ((away.curatedRank?.current ?? 99) < 26)
        })
    } else if (week === 999) { // CFP
        result = result.filter((g: ESPNScheduleEvent) => {
            const gameNote = g.competitions[0].notes.length > 0 ? g.competitions[0].notes[0].headline : ""
            return (
                gameNote.includes("CFP")
                || gameNote.includes("College Football Playoff")
            )
        })
    }
    return result;
}

export async function getCurrentScoreboard(cacheReadEnabled = true, cacheWriteEnabled = false): Promise<ESPNScheduleEvent[]> {
    // for safety, this cache TTL should be longer than the refresh rate
    const cacheTTL = CURRENT_SEASON_CONFIG.scoreboardRefreshRate * CACHE_TTL_MULTIPLIER;
    try {
        if (cacheReadEnabled) { 
            const cachedContent = await env.ESPN_API_CACHE.get("scoreboard", "json");
            if (cachedContent) {
                console.info(`ESPN API cache hit: scoreboard`)
                return (cachedContent as ESPNScheduleEvent[]);
            }
        }

        console.info(`ESPN API cache miss (cacheWriteEnabled: ${cacheWriteEnabled}): scoreboard`)
        // thanks to @pseudo-r on GitHub: https://github.com/pseudo-r/Public-ESPN-API#core-api-v3-enriched-schema
        const resp = await requestESPN(`https://cdn.espn.com/core/college-football/scoreboard?groups=80&size=1000&xhr=1`)

        if (!resp.ok) {
            throw new Error(`ESPN API: scoreboard request received ${resp.statusText}`)
        }
        let espnContent: ESPNCoreScoreboardResponse = await resp.json();
        const result = espnContent?.content.sbData.events || [];

        if (cacheWriteEnabled && result) {
            console.info(`ESPN API cache update: scoreboard`)
            await safeCachePut(env.ESPN_API_CACHE, "scoreboard", JSON.stringify(result), cacheTTL)
        }
        return result;
    } catch (e) {
        console.error(`ERROR while pulling latest scoreboard: ${e}`)
        return [];
    }
}

export async function retrieveGamePage(gameId: string | number): Promise<ESPNPlayByPlayResponse> {
    const cacheBuster = ((new Date()).getTime() * 1000);
    const req = await requestESPN(`https://cdn.espn.com/core/college-football/playbyplay?gameId=${gameId}&xhr=1&render=false&userab=18&${cacheBuster}`);
    const contentRaw = await req.text();
    if (!req.ok) {
        throw new Error(`ESPN Fetch of game_id ${gameId} failed, received status: ${req.statusText} and content ${contentRaw}`)
    }
    const res: ESPNPlayByPlayResponse = JSON.parse(contentRaw);
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
    const req =  await requestESPN(url);
    const res = await req.json()
    return res
}

export async function retrieveTeamInformation(teamId: string | number): Promise<ESPNTeam> {
    return await retrieveTeamEndpoint({ teamId })
}

export interface ESPNTeamEndpointResponse<T> {
  count: number
  pageIndex: number
  pageSize: number
  pageCount: number
  items: T[]
}

export async function retrieveTeamSeasonRecord(season: string | number, teamId: string | number): Promise<ESPNRecord[]> {
    const records: ESPNTeamEndpointResponse<ESPNRecord> = await retrieveTeamEndpoint({ endpoint: "records", season, teamId })
    return records.items
}