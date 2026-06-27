<script lang="ts">
import Chart from 'chart.js/auto'
import type { ChartConfiguration, ChartData, ChartItem } from "chart.js";
import { roundNumber, retrieveValue, hexToRgb, getCurrentViewport, adjustTeamColorsForContrast, adjustColorForContrast, waitForElement, STANDARD_THEME_COLOR, cleanLocation } from "../../utils/misc";

const { team, teamData } = $props();
let season = $state(teamData[0].season)

function generatePercentile(input: number, max: number = 134): number {
    if (!input) {
        return 0;
    }
    let value = (max - input) / max
    let step = Math.round(value * 100)
    return step
}

function generateRadarPercentiles(breakdown: any, titleKey: string) {
    const key = titleKey.toLocaleLowerCase()
    return [
        { title: 'EPA/Play', key: "overall.epaPerPlay", percentile: generatePercentile(breakdown[key]?.overall.epaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "overall.epaPerPlay"), 2, 2) }, 
        { title: 'Early Downs EPA/Play', key: "overall.earlyDownEPAPerPlay", percentile: generatePercentile(breakdown[key]?.overall.earlyDownEPAPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "overall.earlyDownEPAPerPlay"), 2, 2) }, 
        { title: 'Late Downs SR%', key: "overall.lateDownSuccessRate", percentile: generatePercentile(breakdown[key]?.overall.lateDownSuccessRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "overall.lateDownSuccessRate")) * 100, 2, 1)}%` }, 
        { title: 'Avg Distance (3rd)', key: "overall.thirdDownDistance", percentile: generatePercentile(breakdown[key]?.overall.thirdDownDistanceRank, 134), value: roundNumber(parseFloat(retrieveValue(breakdown[key], "overall.thirdDownDistance")), 2, 2) }, 
        { title: 'Rush EPA/Play', key: "rushing.epaPerPlay", percentile: generatePercentile(breakdown[key]?.rushing.epaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "rushing.epaPerPlay"), 2, 2) }, 
        { title: 'Stuff %', key: "rushing.stuffedPlayRate", percentile: generatePercentile(breakdown[key]?.rushing.stuffedPlayRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "rushing.stuffedPlayRate")) * 100, 2, 1)}%` },
        { title: 'Line Yards', key: "rushing.lineYards", percentile: generatePercentile(breakdown[key]?.rushing.lineYardsRank, 134), value: roundNumber(retrieveValue(breakdown[key], "rushing.lineYards"), 2, 2) },
        { title: 'Opportunity %', key: "rushing.opportunityRate", percentile: generatePercentile(breakdown[key]?.rushing.opportunityRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "rushing.opportunityRate")) * 100, 2, 1)}%` }, 
        { title: 'Explosive %', key: "overall.explosiveRate", percentile: generatePercentile(breakdown[key]?.overall.explosiveRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "overall.explosiveRate")) * 100, 2, 1)}%` }, 
        { title: 'Pass Expl %', key: "passing.explosiveRate", percentile: generatePercentile(breakdown[key]?.passing.explosiveRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "passing.explosiveRate")) * 100, 2, 1)}%` }, 
        { title: 'Rush Expl %', key: "rushing.explosiveRate", percentile: generatePercentile(breakdown[key]?.rushing.explosiveRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "rushing.explosiveRate")) * 100, 2, 1)}%` }, 
        { title: 'Non-Expl EPA/Play', key: "overall.nonExplosiveEpaPerPlay", percentile: generatePercentile(breakdown[key]?.overall.nonExplosiveEpaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "overall.nonExplosiveEpaPerPlay"), 2, 2) },
        { title: 'Pass EPA/Play', key: "passing.epaPerPlay", percentile: generatePercentile(breakdown[key]?.passing.epaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "passing.epaPerPlay"), 2, 2) }, 
        { title: 'Yds/DB', key: "passing.yardsPerPlay", percentile: generatePercentile(breakdown[key]?.passing.yardsPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "passing.yardsPerPlay"), 2, 2) }, 
        { title: 'Pass SR%', key: "passing.successRate", percentile: generatePercentile(breakdown[key]?.passing.successRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "passing.successRate")) * 100, 2, 1)}%` }, 
        { title: 'Havoc %', key: "overall.havocRate", percentile: generatePercentile(breakdown[key]?.overall.havocRateRank, 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown[key], "overall.havocRate")) * 100, 2, 1)}%` }, 
    ]
}

function generateDataset(breakdowns: any[], titleKey: string, opponentKey?: string): ChartData<'radar'> {
    const sample = generateRadarPercentiles({}, titleKey);
    

    const teamColors = breakdowns.map(b => {
        return { alternateColor: b.alternateColor, color: b.color }
    })
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const compColor = (isDarkMode) ? hexToRgb("#000000")! : hexToRgb("#FFFFFF")!

    const adjTeamColors = (teamColors.length > 1) ? adjustTeamColorsForContrast(teamColors[0], teamColors[1]) : [adjustColorForContrast(hexToRgb(teamColors[0].color) || hexToRgb(STANDARD_THEME_COLOR)!, hexToRgb(teamColors[0].alternateColor) || hexToRgb(STANDARD_THEME_COLOR)!, compColor)]

    return {
        labels: sample.map(p => p.title),
        datasets: breakdowns.map((b, i) => {
            const teamPercentilesDataset = generateRadarPercentiles(b, (i % 2) == 0 ? titleKey : opponentKey)
            const teamColor = adjTeamColors[i];
            return {
                labels: teamPercentilesDataset.map(p => `${b.teamName} - Raw: ${p.value}`),
                label: b.teamName,
                data: teamPercentilesDataset.map(p => p.percentile),
                fill: true,
                backgroundColor: `rgba(${teamColor.r}, ${teamColor.g}, ${teamColor.b}, 0.2)`,
                borderColor: `rgb(${teamColor.r}, ${teamColor.g}, ${teamColor.b})`,
                pointBackgroundColor: `rgb(${teamColor.r}, ${teamColor.g}, ${teamColor.b})`,
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: `rgb(${teamColor.r}, ${teamColor.g}, ${teamColor.b})`
            }
        })
    };
}

function generateConfig(data: ChartData<'radar'>, title: string): ChartConfiguration<'radar'> {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    return {
        type: 'radar',
        data: data,
        // fill: true,
        plugins: [
            {
                id: 'credits',
                afterDraw: (chart) => {
                    let viewport = getCurrentViewport(document, window)
                    if (viewport == "xl" || viewport == "lg") {
                        let sizeWidth = chart.ctx.canvas.clientWidth;
                        let sizeHeight = chart.ctx.canvas.clientHeight;
                        let imgSize = 25.0;
            
                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "8px Helvetica";
                        chart.ctx.fillStyle = isDarkMode ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText("Metrics shown as percentiles. From GameOnPaper.com, by Akshay Easwaran (@akeaswaran)\nand Saiem Gilani (@saiemgilani)", sizeWidth - (imgSize / 4.0), 7.875 * (sizeHeight / 8))
                        chart.ctx.restore();
                    }
                }
            }
        ],
        options: {
            plugins: {
                title: {
                    display: true,
                    text: title,
                    color: (isDarkMode) ? "white" : "black",
                    font: {
                        size: 15,
                        family: '"Chivo", "Fira Mono", serif'
                    },
                },
            },
            responsive: true,
            elements: {
                line: {
                    borderWidth: 3
                }
            },

            // tooltips: {
            //     callbacks: {
            //         title: function(tooltipItem, data) {
            //             // console.log(tooltipItem)
            //             // console.log(data.labels)
            //             const label = data.labels[tooltipItem[0].index]
            //             return `${label}: ${getNumberWithOrdinal(tooltipItem[0].value)} %tile`
            //         },
            //         label: function(tooltipItem, data) {
            //             return data.datasets[tooltipItem.datasetIndex].label[tooltipItem.index]
            //         }
            //     }
            // },
            scales: {
                r: {
                    min: 0,
                    max: 100,
                    suggestedMin: 0,
                    suggestedMax: 100,
                    angleLines: {
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                    },
                    grid: {
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                    },
                    ticks: {
                        stepSize: 25,
                        backdropColor: (isDarkMode) ? 'rgb(56, 61, 63)' : 'rgba(255, 255, 255, 0.75)'
                    },
                    pointLabels: {
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                    }
                }
            }
        },
    }
}

let offRadarChart: Chart | null = null;
let defRadarChart: Chart | null = null;

async function waitToGenerateChart() {
    try {
        const selectedTeamData = teamData.filter((p: any) => parseInt(p.season) == parseInt(season))

        const offRadarCtx = await waitForElement(document, "offensive-canvas");
        const defRadarCtx = await waitForElement(document, "defensive-canvas");

        if (offRadarChart) {
            offRadarChart?.destroy()
        }

        offRadarChart = new Chart(
            offRadarCtx as ChartItem,
            generateConfig(
                generateDataset(selectedTeamData, "Offensive"),
                `${cleanLocation(team)} ${season} Offensive Profile`
            )
        );


        if (defRadarChart) {
            defRadarChart?.destroy()
        }

        defRadarChart = new Chart(
            defRadarCtx as ChartItem,
            generateConfig(
                generateDataset(selectedTeamData, "Defensive"),
                `${cleanLocation(team)} ${season} Defensive Profile`
            )
        );

    } catch (e) {
        console.error(e);
        const container = document.getElementById(`radar_container`);
        if (container) {
            container.innerHTML = `<div class="col-12"><p class='m-0 mb-3 text-muted text-small'>Unable to generate charts. Please reach out to <a href="https://twitter.com/akeaswaran">@akeaswaran</a> or <a href="https://twitter.com/saiemgilani">@saiemgilani</a> on Bluesky with the page and chart options you're trying to access.</p></div>`
        }
    }
}

if (document.readyState !== 'loading') {
    console.log(`DOM ready state`)
    waitToGenerateChart()
} else {
    document.addEventListener('DOMContentLoaded', () => {
        console.log(`DOM content loaded state`)
        waitToGenerateChart()
    })
}

function onChangeValue(e: Event) {
    season = parseInt(e.target.value)
    waitToGenerateChart()
}

</script>


<div class="container">
    <div class="row mb-3">
        <div class="col-lg-6 col-xs-12">
            <h2 class="d-inline">Profile History</h2>
            <p class="text-small text-muted">Data shown is from FBS vs FBS games only. Based on <a href="https://twitter.com/ESPN_BillC">Bill Connelly</a>'s team profile radars (<a href="https://www.sbnation.com/college-football/2018/7/16/17532360/georgia-tech-football-2018-preview-schedule-roster">example</a>).</p>
        </div>
        <div class="ms-auto col-lg-2 col-xs-12">
            <select class="form-select form-select-md" onchange={onChangeValue}>
				<option value="-1" disabled>Choose Season...</option>
				{#each teamData as t}
					<option value={t.season} selected={(season == t.season)}>{t.season}</option>
				{/each}
            </select>
        </div>
    </div>
    <div class="row mb-3" id="radar_container">
        <div class="col-lg-6 col-xs-12 mb-xs-3">
            <canvas id="offensive-canvas" style="display: block; box-sizing: border-box; height: 200px; width: 200px;" width="400px" height="400px"></canvas>
        </div>
        <div class="col-lg-6 col-xs-12 mb-xs-3">
            <canvas id="defensive-canvas" style="display: block; box-sizing: border-box; height: 200px; width: 200px;" width="400px" height="400px"></canvas>
        </div>
    </div>
</div>