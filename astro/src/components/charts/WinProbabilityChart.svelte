<script>
import Chart from 'chart.js/auto';
import {LineController} from "chart.js";
import { cleanAbbreviation, roundNumber, getNumberWithOrdinal, translateValue, getCurrentViewport } from '../../utils/misc';
import { GradientFillLineController } from '../../resources/chart'

const { game, percentiles } = $props()

const homeComp = game.gameInfo.competitors[0];
const awayComp = game.gameInfo.competitors[1];
const homeTeam = homeComp.team;
const awayTeam = awayComp.team;

function createVerticalLinePlugin(id, title, value, color, lineWidth, xAxisId = 'x', yAxisId = 'y', yMin = null, yMax = null) {
    console.log(
        [id, title, value, color, lineWidth, xAxisId, yAxisId, yMin, yMax]
    )

    const callback = (chart) => {
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        
        var top = chart.chartArea.top;
        var bottom = chart.chartArea.bottom;
        if (yMin != null && yMax != null) {
            top = yScale.getPixelForValue(yMax);
            bottom = yScale.getPixelForValue(yMin);
        }

        const xValue = xScale.getPixelForValue(value);
        const ctx = chart.ctx;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(xValue, top);
        ctx.lineTo(xValue, bottom);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        ctx.restore();

        // only draw titles when there's space
        let viewport = getCurrentViewport(document, window)
        if (viewport == "xl" || viewport == "lg") {
            chart.ctx.save()
            chart.ctx.textAlign = "left"
            chart.ctx.font = "10px Helvetica";
            chart.ctx.fillStyle = color;
            chart.ctx.fillText(title, xValue + 5, top + 15)
            chart.ctx.restore();
        }
    }
    return {
        id: id,
        beforeDraw: callback
    };
}

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

function translateWP(input) {
  return translateValue(input, 0.0, 1.0, -1.0, 1.0)
}

function printSpread() {
    if (parseFloat(game.homeTeamSpread) > 0) {
        return `${cleanAbbreviation(homeTeam)} -${game.homeTeamSpread}`
    } else if (parseFloat(game.homeTeamSpread) < 0) {
        return `${cleanAbbreviation(awayTeam)} ${game.homeTeamSpread}`
    } else {
        return "PUSH"
    }
}
const lastPlay = game.plays[game.plays.length - 1]
const gameInProgress = !(game.gameInfo.status.type.completed == true) && ((game.gameInfo.status.type.name.includes("STATUS_IN_PROGRESS") || game.gameInfo.status.type.name.includes("STATUS_END_PERIOD") || game.gameInfo.status.type.name.includes("STATUS_HALFTIME")) && game.plays.length > 0);

const geiVal = (Math.round(game.gameInfo.gei * 100) / 100) 
const geiPctl = geiGenerateColorRampValue(geiVal)
const geiTitle = `%ile: ${getNumberWithOrdinal(geiPctl.pctl)}\nMost Boring: ${geiPctl.min}\nMedian: ${geiPctl.mid}\nMost Exciting: ${geiPctl.max}`;

async function generateChart() {
    GradientFillLineController.id = 'GradientFillLineController';
    GradientFillLineController.defaults = LineController.defaults;

    // Stores the controller so that the chart initialization routine can look it up
    Chart.register(GradientFillLineController);

    const plays = [...game.plays];
    // console.log(game.plays[0])
    var timestamps = [...Array(plays.length).keys()];
    let periodMarkers = []
    let periodTracks = {}
    for (let i = 0; i < (plays.length - 1); i++) {
        const j = (i - 1);
        const prevPlay = plays[j];
        const curPlay = plays[i];

        if (!prevPlay || ((parseInt(prevPlay.period) < parseInt(curPlay.period)) && (parseInt(curPlay.period) <= 5))) {
            const title = parseInt(curPlay.period) < 5 ? `Q${curPlay.period}` : `OT`;

            if (Object.keys(periodTracks).includes(title)) {
                continue;
            }

            periodMarkers.push(
                createVerticalLinePlugin(
                    `period-${curPlay.period}`,
                    title,
                    i,
                    window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252',
                    2.5,
                    'x-axis-0',
                    'y-axis-0',
                    -1,
                    1
                )
            )
            periodTracks[title] = i;
        }
    }
    // const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // const [awayTeamColor, homeTeamColor] = adjustColorsForContrast(awayTeam, homeTeam)
    var homeTeamWP = game.plays.map(p => (p.pos_team == homeTeam.id) ? translateWP(p.winProbability.before) : translateWP(1.0 - p.winProbability.before));

    // handle end of game
    if (game.gameInfo.status.type.completed == true) {
        if (homeComp.winner == true || parseInt(homeComp.score) > parseInt(awayComp.score)) {
            timestamps.push((timestamps[timestamps.length - 1] + 1))
            homeTeamWP.push(translateWP(1.0))
        } else if (awayComp.winner == true || parseInt(homeComp.score) < parseInt(awayComp.score)) {
            timestamps.push((timestamps[timestamps.length - 1] + 1))
            homeTeamWP.push(translateWP(0.0))
        }
    }

    var targetDataSet = {
        fill: true,
        lineTension: 0,
        pointRadius: 0,
        borderWidth: 3,
        label: null,
        data: homeTeamWP,
    };


    var wpChart = new Chart(document.getElementById("wpChart"), {
        type: 'GradientFillLineController',
        plugins: periodMarkers,
        data: {
            labels: timestamps,
            datasets: [
                targetDataSet,
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    suggestedMax: 1.0,
                    suggestedMin: -1.0,
                    ticks: {
                        stepSize: 0.5,
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252',
                        callback: function(value) {
                            if (value > 0) {
                                let transVal = translateValue(value, 0.0, 1.0, 50, 100);
                                return `${cleanAbbreviation(homeTeam)} ${(Math.round(Math.abs(transVal) * 100) / 100)}%`
                            } else if (value < 0) {
                                let transVal = translateValue(value, -1.0, 0.0, 100, 50);
                                return `${cleanAbbreviation(awayTeam)} ${(Math.round(Math.abs(transVal) * 100) / 100)}%`
                            } else {
                                return "50%";
                            }
                        }
                    },
                    title: {
                        display: true,
                        text: "Win Probability",
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    grid: {
                        color: (line) => {
                            if (line.tick.value == 0) {
                                return (isDarkMode) ? "white" : "#ACACAC"
                            }
                            return (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                        }, 
                        borderColor: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                    }
                },
                x: {
                    ticks: {
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    title: {
                        display: true,
                        text: "Play Number",
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    grid: {
                        color: (line) => {
                            if (line.tick.value == 0) {
                                return (isDarkMode) ? "white" : "#ACACAC"
                            }
                            return (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                        },
                        borderColor: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                    }
                }
            },
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    callbacks: {
                        title: function(contexts) {
                            return `Play Number: ${contexts[0].dataIndex}` 
                        },
                        label: function(context) {
                            // value is always from perspective of home team
                            if (context.parsed.y > 0) {
                                let transVal = translateValue(context.parsed.y, 0.0, 1.0, 50, 100);
                                return `${cleanAbbreviation(homeTeam)} WP: ${(Math.round(Math.abs(transVal) * 10) / 10)}%`
                            } else if (context.parsed.y < 0) {
                                let transVal = translateValue(context.parsed.y, -1.0, 0.0, 100, 50);
                                return `${cleanAbbreviation(awayTeam)} WP: ${(Math.round(Math.abs(transVal) * 10) / 10)}%`;
                            } else {
                                return "50%";
                            }
                        }
                    }
                }
            },
        }
    })

    document.getElementById("wp-download").addEventListener('click', function() {
        /*Get image of canvas element*/
        var url_base64jp = wpChart.toBase64Image();
        /*get download button (tag: <a></a>) */
        var a =  document.getElementById("wp-download");
        /*insert chart image url to download button (tag: <a></a>) */
        a.href = url_base64jp;
    });
}

document.addEventListener('DOMContentLoaded', generateChart);

</script>

<div class="row">
    <div>
        <h2 class="mb-0">Win Probability</h2>
        <p class="m-0 text-muted text-small" hidden={lastPlay.gameSpreadAvailable}>ESPN does not list betting odds for this game, so we've used default values: {cleanAbbreviation(homeTeam)} -2.5, O/U 55.5.</p>
        <p class="text-small">
            {#if !gameInProgress}
            <a href="https://www.opensourcefootball.com/posts/2020-08-21-game-excitement-and-win-probability-in-the-nfl/" title="Measures 'game excitement' by absolute changes in win probability. May not match eye-test in games with heavy favorites.">Game Excitement Index:</a> <span class={geiPctl.ramp_class} title={geiTitle}>{ geiVal.toFixed(2) }</span> | 
            {/if}
            Odds: {printSpread()}, O/U {roundNumber(parseFloat(game.overUnder), 2, 1)}
            {#if gameInProgress}
                {#if (lastPlay.winProbability.before >= 0.5) }
                | Current: {(lastPlay.pos_team == homeTeam.id) ? cleanAbbreviation(homeTeam) : cleanAbbreviation(awayTeam)} {((Math.round(lastPlay.winProbability.before * 1000) / 1000) * 100).toFixed(1)}%
                {/if}
                {#if (lastPlay.winProbability.before < 0.5) }
                | Current: {(lastPlay.pos_team == homeTeam.id) ? cleanAbbreviation(homeTeam) : cleanAbbreviation(awayTeam)} {((Math.round((1.0 - lastPlay.winProbability.before) * 1000) / 1000) * 100).toFixed(1)}%
                {/if}
            {/if}
            | <a id="wp-download" download={`game-wp-${game.id}.jpg`} href="#">Download Chart</a>
        </p>
    </div>
    <div class="w-100"  width="900" height="380"><canvas id="wpChart"></canvas></div>
</div>
