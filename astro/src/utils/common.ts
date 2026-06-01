import { SpiceLevel, type ESPNCompetitor, type ESPNScheduleEvent } from "../resources/game"
import { GLOBAL_GROUP_LIST } from "../resources/schedule"
import { FBS_CONFERENCES, MEME_LIST } from "./constants"

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

export function cleanField(team: { id: string | number, abbreviation: string, name: string, location: string }, field: "abbreviation" | "name" | "location"): string {
    if (MEME_LIST.includes(Number(team.id))) {
        return team[field].toLocaleLowerCase()
    }
    return team[field]
}

export function cleanAbbreviation(team: { id: string | number, abbreviation: string, name: string, location: string }): string {
    return cleanField(team, "abbreviation")
}



// const DateTime = ;
// var gameContexts = document.getElementsByClassName("game-context");
// if (gameContexts.length > 0) {
//     console.log(gameContexts)
//     for (var i = 0; i < gameContexts.length; i++) {
//         let contextElem = gameContexts[i];
//         let dateSpan = contextElem.querySelector('.game-date')
//         let statusSpan = contextElem.querySelector('.game-status')
//         if (statusSpan && (statusSpan.innerText.includes('FINAL') || statusSpan.innerText.startsWith('F'))) {
//             dateSpan.innerText = formatDateTime(dateSpan.innerText, DateTime.DATE_SHORT)
//         } else if (dateSpan) {
//             dateSpan.innerText = formatDateTime(dateSpan.innerText, DateTime.DATETIME_SHORT)
//         }
//     }
// } else {
//     console.log("no game dates found")
// }