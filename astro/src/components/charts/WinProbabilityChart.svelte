<script>
import { cleanAbbreviation, roundNumber, getNumberWithOrdinal } from '../../utils/misc';

const { game, percentiles } = $props()

function geiGenerateColorRampValue(input) {
    if (percentiles.length == 0) {
        //console.log('no pctls available')
        return {
            pctl: null,
            ramp_class: null,
            min: null,
            mid: null,
            max: null
        }
    }

    //console.log(`calc pctl for key ${adjKey} w/ val ${value}`)

    let basePctls = percentiles.map(item => {
        let val = item["gei"];
        return parseFloat(val)
    })
    basePctls.sort((a, b) => {
        return parseFloat(a) - parseFloat(b)
    })

    if (basePctls[0] == null || basePctls.length == 0) {
        //console.log('all ptcls null for key ' + adjKey)
        return {
            pctl: null,
            ramp_class: null,
            min: null,
            mid: null,
            max: null
        }
    }
    
    let pctls = [...basePctls];
    //console.log(`mapped pctls for key ${adjKey}: ${JSON.stringify(pctls, null, 2)}`)
    pctls = pctls.filter(item => {
        return parseFloat(item) <= parseFloat(input)
    });

    // console.log(`pct calc for key ${key} is ${pct}`)
    let value = parseFloat(pctls.length) / 100
    let step = Math.round(value / 0.1)
    let clampedStep = Math.min(Math.max(step, 0), 9)

    if (clampedStep == 4 || clampedStep == 5) {
        return {
            pctl: pctls.length,
            ramp_class: null,
            min: roundNumber(basePctls[0], 2, 2),
            mid: roundNumber(basePctls[Math.floor(basePctls.length / 2)], 2, 2),
            max: roundNumber(basePctls[basePctls.length - 1], 2, 2),
        }
    } else {
        return {
            pctl: pctls.length,
            ramp_class: ` hulk-bg-level-${clampedStep}`,
            min: roundNumber(basePctls[0], 2, 2),
            mid: roundNumber(basePctls[Math.floor(basePctls.length / 2)], 2, 2),
            max: roundNumber(basePctls[basePctls.length - 1], 2, 2),
        }
    }
}

function printSpread() {
    if (parseFloat(game.homeTeamSpread) > 0) {
        return `${cleanAbbreviation(game.gameInfo.home)} -${game.homeTeamSpread}`
    } else if (parseFloat(game.homeTeamSpread) < 0) {
        return `${cleanAbbreviation(game.gameInfo.away)} ${game.homeTeamSpread}`
    } else {
        return "PUSH"
    }
}
const lastPlay = game.plays[game.plays.length - 1]
const gameInProgress = !(game.gameInfo.status.type.completed == true) && ((game.gameInfo.status.type.name.includes("STATUS_IN_PROGRESS") || game.gameInfo.status.type.name.includes("STATUS_END_PERIOD") || game.gameInfo.status.type.name.includes("STATUS_HALFTIME")) && game.plays.length > 0);

const geiVal = (Math.round(game.gameInfo.gei * 100) / 100) 
const geiPctl = geiGenerateColorRampValue(geiVal)
const geiTitle = `%ile: ${getNumberWithOrdinal(geiPctl.pctl)}\nMost Boring: ${geiPctl.min}\nMedian: ${geiPctl.mid}\nMost Exciting: ${geiPctl.max}`;


</script>

<div class="row">
    <div>
        <h2 class="mb-0">Win Probability</h2>
        <p class="m-0 text-muted text-small" hidden={lastPlay.gameSpreadAvailable}>ESPN does not list betting odds for this game, so we've used default values: {cleanAbbreviation(game.gameInfo.home)} -2.5, O/U 55.5.</p>
        <p class="text-small">
            {#if !gameInProgress}
            <a href="https://www.opensourcefootball.com/posts/2020-08-21-game-excitement-and-win-probability-in-the-nfl/" title="Measures 'game excitement' by absolute changes in win probability. May not match eye-test in games with heavy favorites.">Game Excitement Index:</a> <span class={geiPctl.ramp_class} title={geiTitle}>{ geiVal.toFixed(2) }</span> | 
            {/if}
            Odds: {printSpread()}, O/U {roundNumber(parseFloat(game.overUnder), 2, 1)}
            {#if gameInProgress}
                {#if (lastPlay.winProbability.before >= 0.5) }
                | Current: {(lastPlay.pos_team == game.gameInfo.home.id) ? cleanAbbreviation(game.gameInfo.home) : cleanAbbreviation(game.gameInfo.away)} {((Math.round(lastPlay.winProbability.before * 1000) / 1000) * 100).toFixed(1)}%
                {/if}
                {#if (lastPlay.winProbability.before < 0.5) }
                | Current: {(lastPlay.pos_team == game.gameInfo.home.id) ? cleanAbbreviation(game.gameInfo.home) : cleanAbbreviation(game.gameInfo.away)} {((Math.round((1.0 - lastPlay.winProbability.before) * 1000) / 1000) * 100).toFixed(1)}%
                {/if}
            {/if}
            | <a id="wp-download" download={`game-wp-${game.id}.jpg`} href="#">Download Chart</a>
        </p>
    </div>
    <div class="w-100"  width="900" height="380"><canvas id="wpChart"></canvas></div>
</div>
