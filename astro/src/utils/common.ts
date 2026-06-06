import { SpiceLevel, type ESPNCompetitor, type ESPNScheduleEvent } from "../resources/espn"
import { GLOBAL_GROUP_LIST } from "../resources/schedule"
import { FBS_CONFERENCES, MEME_LIST } from "./constants"
import { roundNumber } from "./misc"

export function formatScore(score: string, winner: boolean, complete: boolean): string {
    if (winner && complete) {
        return `<strong>${score}</strong>`
    } else if (!winner && complete) {
        return `<span style="opacity: 0.5;">${score}</span>`
    } else {
        return `<span>${score}</span>`
    }
}

export function cleanScore(score: { displayValue: string } | string): number {
    return (typeof(score) == 'object') ? parseInt(score.displayValue) : parseInt(score)
}

export function calculateSpiceLevel(g: ESPNScheduleEvent): SpiceLevel {
    const homeScore = cleanScore(g.competitions[0].competitors[0].score);
    const awayScore = cleanScore(g.competitions[0].competitors[1].score);
    const period = g.status.period;
    const clock = g.status.clock;
    const homeConferenceId = g.competitions[0].competitors[0].team.conferenceId;
    const awayConferenceId = g.competitions[0].competitors[1].team.conferenceId;
    const homeRank = g.competitions[0].competitors[0].curatedRank?.current ?? 99;
    const awayRank = g.competitions[0].competitors[1].curatedRank?.current ?? 99;
    
    if (g.status.type.completed == true || period < 1 || g.status.type.name.includes("STATUS_SCHEDULED") || g.status.type.detail.includes("Cancel") || g.status.type.detail.includes("Postpone")) {
        return SpiceLevel.BELL;
    }

    if ((period == 2 && (Math.abs(homeScore - awayScore) > 38))
        || (period == 3 && (Math.abs(homeScore - awayScore) > 28))
        || (period == 4 && (Math.abs(homeScore - awayScore) > 22))) {
        return SpiceLevel.BELL; // garbage time
    }
    //
    var isLateInHalf = (g.status.type.name.includes("STATUS_IN_PROGRESS") || g.status.type.name.includes("STATUS_HALFTIME")) && (period > 4) || (period == 2 && clock <= 300 && clock > 0) || (period == 4 && clock <= 300 && clock > 0);
    var isMiddleHalf = g.status.type.name.includes("STATUS_IN_PROGRESS") && (period >= 3 && clock <= 450 && clock > 0);
    var isEarlyGame = g.status.type.name.includes("STATUS_IN_PROGRESS") && (period == 1 && clock >= 450);

    var oneScoreDriveTime = ((clock % 900) >= 60);
    var twoScoreDriveTime = ((clock % 900) >= 120);
    var oneScorePossibleByTrailingTeam = (oneScoreDriveTime && (Math.abs(homeScore - awayScore) >= 0 && Math.abs(homeScore - awayScore) <= 8));
    var twoScoresPossibleByTrailingTeam = (twoScoreDriveTime && (Math.abs(homeScore - awayScore) >= 9 && Math.abs(homeScore - awayScore) <= 16));
    var fbsVsFcsGame = ((!FBS_CONFERENCES.includes(homeConferenceId) && FBS_CONFERENCES.includes(awayConferenceId)) || (!FBS_CONFERENCES.includes(awayConferenceId) && FBS_CONFERENCES.includes(homeConferenceId)))
    var homeFcsLeading = (!FBS_CONFERENCES.includes(homeConferenceId) && FBS_CONFERENCES.includes(awayConferenceId) && (homeScore - awayScore) >= 0);
    var awayFcsLeading = (FBS_CONFERENCES.includes(homeConferenceId) && !FBS_CONFERENCES.includes(awayConferenceId) && (homeScore - awayScore) <= 0)

    if ((isMiddleHalf && (oneScorePossibleByTrailingTeam || twoScoresPossibleByTrailingTeam)) && ((homeRank < 26 && awayRank > 25)
    || (awayRank < 26 && homeRank > 25))) {
        return SpiceLevel.CAYENNE;
    }
    
    if (!isEarlyGame && fbsVsFcsGame && (homeFcsLeading || awayFcsLeading)) {
        return SpiceLevel.REAPER;
    }
    
    if (isLateInHalf && (oneScorePossibleByTrailingTeam || twoScoresPossibleByTrailingTeam)) {
        if (homeRank < 26 && awayRank < 26) {
            return SpiceLevel.GHOST;
        } else {
            return SpiceLevel.SERRANO;
        }
    }
    
    if (isLateInHalf && (Math.abs(homeScore - awayScore) >= 0 && Math.abs(homeScore - awayScore) < 8)) {
        return SpiceLevel.SERRANO;
    }

    return SpiceLevel.BELL;
}

export function isChampionshipEvent(g: ESPNScheduleEvent): boolean {
    const gameNote = (g.competitions[0].notes.length > 0) ? g.competitions[0].notes[0].headline : "";
    return (
        gameNote.includes("CFP")
        || gameNote.includes("College Football Playoff")
        || gameNote.includes("National Championship")
        || gameNote.includes("FCS Championship")
        || gameNote.includes("Celebration Bowl") // HBCU National Championship
        || gameNote.includes("Division II Championship")
        || gameNote.includes("Division III Championship")
    );
}

export function getRecordString(competitor: ESPNCompetitor): string {
    if (!competitor.records) {
        return '';
    }
    const records = competitor.records || [];
    const overallStuff = records.filter(item => item.type == "total")[0];
    const overall = overallStuff?.summary || "0-0"
    
    let base = '';
    if (overall) {
        base += `${overall}`
    }

    const confStuff = records.filter(item => item.type == "vsconf")[0];
    const confRec = confStuff?.summary || "0-0"

    const indyConfs = [18, 35, 80, 81];
    const confId = parseInt(competitor.team.conferenceId);
    // const conf = CONFERENCE_MAP[confId];
    const conf = GLOBAL_GROUP_LIST.find((p) => p.id == confId);
    if (confStuff && conf && !indyConfs.includes(confId)) {
        base += `, ${confRec} ${conf}`
    } else if (conf) {
        base += ` ${conf}`
    }
    return `<span class="small text-muted h6">${base}</span>`;
}

export function cleanField(team: any, field: "abbreviation" | "name" | "location" | "team"): string {
    if (team.team_id && MEME_LIST.includes(Number(team.team_id))) {
        return team[field]?.toLocaleLowerCase() || ""
    }

    if (team.teamId && MEME_LIST.includes(Number(team.teamId))) {
        return team[field]?.toLocaleLowerCase() || ""
    }

    if (MEME_LIST.includes(Number(team.id))) {
        return team[field]?.toLocaleLowerCase() || ""
    }
    return team[field] || ""
}

export function cleanAbbreviation(team: any): string {
    return cleanField(team, "abbreviation")
}

export function generateMarginalString(input: number, power10: number, fixed: number): string {
    if (input >= 0) {
        return `+${roundNumber(input, power10, fixed)}`;
    } else {
        return roundNumber(input, power10, fixed);
    }
}

export function formatRank(rank: number) {
    if (rank == null || (!rank && rank != 0)) {
        return "N/A"
    }

    let tied = String(rank)?.includes(".5") || false
    let rankString = ""
    if (rank && tied) {
        rankString = `T-${roundNumber(Math.floor(rank), 2, 0)}`;
    } else if (rank) {
        rankString = `${roundNumber(Math.floor(rank), 2, 0)}`
    } else {
        rankString = "N/A"
    }
    return rankString
}


export function generateColorRampValue(input: number | null, max: number): string | null {
    if (!input) {
        return null;
    }


    let value = (max - input) / max
    let step = Math.round(value / 0.1)
    let clampedStep = Math.min(Math.max(step, 0), 9)

    let hex = null
    if (clampedStep == 4 || clampedStep == 5) {
        return null
    } else {
        return `hulk-bg-level-${clampedStep}`
    }
}

export function retrieveValue(dictionary: any, key: string): string {
    const subKeys = key.split('.')
    let sub = dictionary;
    for (const k of subKeys) {
        sub = sub[k];
    }
    return sub;
}

export function getPercentileKey(metric: string): string {
    switch (metric) {
        case "overall.epaPerPlay": 
            return "epaPerPlay";
        case "overall.yardsPerPlay": 
            return "yardsPerPlay";
        case "overall.successRate": 
            return "successRate";
        case "passing.epaPerPlay": 
            return "epaPerDropback";
        case "passing.yardsPerPlay": 
            return "yardsPerDropback";
        case "passing.successRate": 
            return "passingSuccessRate";
        case "rushing.epaPerPlay": 
            return "epaPerRush";
        case "rushing.yardsPerPlay": 
            return "yardsPerRush";
        case "rushing.successRate": 
            return "rushingSuccessRate";
        case "overall.havocRate": 
            return "havocRate";
        case "passing.explosiveRate":
            return "passingExplosivePlayRate";
        case "rushing.explosiveRate":
            return "rushingExplosivePlayRate";
        case "rushing.opportunityRate":
            return "rushOpportunityRate";
        case "rushing.lineYards":
            return "lineYards";
        case "rushing.stuffedPlayRate":
            return "playStuffedRate";
        case "overall.explosiveRate":
            return "explosivePlayRate";
        case "overall.nonExplosiveEpaPerPlay":
            return "nonExplosiveEpaPerPlay";
        case "overall.earlyDownEPAPerPlay":
            return "earlyDownEpaPerPlay";
        case "overall.lateDownSuccessRate":
            return "lateDownSuccessRate";
        case "overall.thirdDownDistance":
            return "thirdDownDistance";
        default:
            return metric;
    }
}