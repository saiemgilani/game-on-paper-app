<script lang="ts">
import type { ESPNScheduleEvent } from "../../resources/espn";
import LocalDate from "../LocalDate.svelte";
import { DateTime } from "luxon";
import { SpiceLevel, cleanScore, isChampionshipEvent } from "../../utils/misc";
import { FBS_CONFERENCES } from "../../utils/constants";
import BroadcastButton from "./BroadcastButton.svelte";
import GameSituation from "./GameSituation.svelte";
import TeamRow from "./TeamRow.svelte";


interface GameThumbTheme {
    borderClass?: string
    buttonClass: string
    outlineClass?: string
    textClass?: string
}

const { game } = $props();

const espnGame = (game as ESPNScheduleEvent);
const espnGameComp = espnGame.competitions[0];
const homeComp = espnGameComp.competitors[0];
const awayComp = espnGameComp.competitors[1];
const homeScore = cleanScore(homeComp.score);
const awayScore = cleanScore(awayComp.score);
const gameStatus = espnGameComp.status;
const gameNote = espnGame.competitions[0].notes.length > 0 ? espnGame.competitions[0].notes[0].headline : ""
const isChamp = isChampionshipEvent(gameNote);

// const favorites = await Astro.session?.get('favorites') || SESSION_FAVORITES_DEFAULT;
// const isFavorite = isEventFavorite(favorites, game)



export function calculateSpiceLevel(g: ESPNScheduleEvent): SpiceLevel {
    const homeScore = cleanScore(g.competitions[0].competitors[0].score);
    const awayScore = cleanScore(g.competitions[0].competitors[1].score);
    if (!g.status) {
        return SpiceLevel.BELL;
    }

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

function generateThumbTheme(): GameThumbTheme {
    const spiceLevel = calculateSpiceLevel(game)
    if (isChamp) {
        return {
            buttonClass: "btn-outline-championship",
            borderClass: (spiceLevel == SpiceLevel.BELL) ? undefined : `spice-level-${spiceLevel}`,
            outlineClass: "outline-championship",
            textClass: "text-championship"
        }
    }

    // if (isFavorite) {
    //     return {
    //         buttonClass: "btn-outline-favorite",
    //         borderClass: (spiceLevel == SpiceLevel.BELL) ? "outline-favorite" : `spice-level-${spiceLevel}`,
    //         outlineClass: "outline-favorite",
    //         textClass: "text-favorite"
    //     }
    // }
    return {
        buttonClass: "btn-outline-primary",
        borderClass: `spice-level-${spiceLevel}`,
        textClass: "text-primary"
    }
}

const { buttonClass, borderClass, outlineClass, textClass } = generateThumbTheme()
const hasLastPlay = (espnGameComp.situation && espnGameComp.situation?.lastPlay);
const canShowSituation = (
    (!(gameStatus.type.completed == true || gameStatus.type.detail.includes("Cancel") || gameStatus.type.detail.includes("Postpone")))
    && (espnGameComp.situation != null && espnGameComp.situation.lastPlay != null)
)
const canLoadStats = gameStatus && (
    (gameStatus.type.name.includes("STATUS_DELAYED") && !hasLastPlay) 
    || gameStatus.type.detail.includes("Cancel") 
    || gameStatus.type.detail.includes("Postpone") 
    || (gameStatus.type.name.includes("STATUS_IN_PROGRESS") && !hasLastPlay)
)
const canLoadStatsTheme = canLoadStats ? `disabled` : ``
</script>

<div class="col-xl-3 col-lg-6">
    <div class={`row border rounded m-2 mb-4 ${outlineClass} ${borderClass}`}>
        <div class="col p-3">
            <div class="d-flex justify-content-between">
                <strong class={`d-inline-block mb-2 ${textClass} text-small`}>
                    {#if (gameStatus.type.completed == true) }
                    <LocalDate divClass={"m-0"} prefix={gameStatus.type.detail} date={espnGame.date} format={DateTime.DATETIME_SHORT} />
                    {/if}
                    {#if (gameStatus.type.name.includes("STATUS_SCHEDULED"))}
                    <LocalDate divClass={"m-0"} prefix={""} date={espnGame.date} format={DateTime.DATETIME_SHORT} />
                    {/if}
                    {#if (gameStatus.type.completed != true) && (!gameStatus.type.name.includes("STATUS_SCHEDULED"))}
                    {@html gameStatus.type.detail}
                    {/if}
                </strong>
            </div>
            <TeamRow espnComp={awayComp} espnStatus={gameStatus} winner={awayScore > homeScore} completed={gameStatus.type.completed == true} hasBall={espnGameComp.situation?.lastPlay?.end?.team?.id == awayComp.id} isRedZone={espnGameComp.situation?.isRedZone} spacer="" />
            <TeamRow espnComp={homeComp} espnStatus={gameStatus} winner={awayScore < homeScore} completed={gameStatus.type.completed == true} hasBall={espnGameComp.situation?.lastPlay?.end?.team?.id == homeComp.id} isRedZone={espnGameComp.situation?.isRedZone} spacer="mb-3" />
            <GameSituation hidden={canShowSituation} game={espnGame} />
            <div class="d-flex justify-content-between">
                <div class="text-left">
                    <a class={`btn btn-sm ${buttonClass} ${canLoadStatsTheme}`} role="button" href={`/game/${espnGame.id}`}>{ (gameStatus.type.name.includes("STATUS_SCHEDULED")) ? "Preview" : "Stats" }</a>
                </div>
                <div class="text-right">
                    <BroadcastButton game={espnGame} />
                </div>
            </div>
        </div>
    </div>
</div>