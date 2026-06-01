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

export enum SpiceLevel {
    BELL = 0,
    SERRANO,
    CAYENNE,
    GHOST,
    REAPER
}