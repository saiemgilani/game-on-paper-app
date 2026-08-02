import type { ChartConfiguration, ChartData } from "chart.js";
import { roundNumber, retrieveValue, hexToRgb, getCurrentViewport, adjustTeamColorsForContrast, adjustColorForContrast, STANDARD_THEME_COLOR, getNumberWithOrdinal, cleanField } from "./misc";


function generatePercentile(input: number, max: number = 134): number {
    if (!input) {
        return 0;
    }
    let value = (max - input) / max
    let step = Math.round(value * 100)
    return step
}

export function generateRadarPercentiles(breakdown: any, titleKey: string) {
    const key = titleKey.toLocaleLowerCase()
    let suffix = ""
    if (key == "defensive") {
        suffix = "_def";
    } else if (key == "offensive") {
        suffix = "_off";
    }
    const base = [
        { title: 'EPA/Play', key: `EPAplay${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `EPAplay${suffix}_rank`)), 134), value: roundNumber(retrieveValue(breakdown, `EPAplay${suffix}`), 2, 2) }, 
        { title: 'Early Downs EPA/Play', key: `early_down_EPA${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `early_down_EPA${suffix}_rank`)), 134), value: roundNumber(retrieveValue(breakdown, `early_down_EPA${suffix}`), 2, 2) }, 
        { title: 'Late Downs SR%', key: `late_down_success${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `late_down_success${suffix}_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `late_down_success${suffix}`)) * 100, 2, 1)}%` }, 
        { title: 'Avg Distance (3rd)', key: `third_down_distance${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `third_down_distance${suffix}_rank`)), 134), value: roundNumber(parseFloat(retrieveValue(breakdown, `third_down_distance${suffix}`)), 2, 2) }, 
        { title: 'Rush EPA/Play', key: `EPAplay${suffix}_rush`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `EPAplay${suffix}_rush_rank`)), 134), value: roundNumber(retrieveValue(breakdown, `EPAplay${suffix}_rush`), 2, 2) }, 
        { title: 'Stuff %', key: `play_stuffed${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `play_stuffed${suffix}_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `play_stuffed${suffix}`)) * 100, 2, 1)}%` },
        { title: 'Line Yards', key: `line_yards${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `line_yards${suffix}_rank`)), 134), value: roundNumber(retrieveValue(breakdown, `line_yards${suffix}`), 2, 2) },
        { title: 'Opportunity %', key: `opportunity_rate${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `opportunity_rate${suffix}_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `opportunity_rate${suffix}`)) * 100, 2, 1)}%` }, 
        { title: 'Explosive %', key: `explosive${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `explosive${suffix}_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `explosive${suffix}`)) * 100, 2, 1)}%` }, 
        { title: 'Pass Expl %', key: `explosive${suffix}_pass`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `explosive${suffix}_pass_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `explosive${suffix}_pass`)) * 100, 2, 1)}%` }, 
        { title: 'Rush Expl %', key: `explosive${suffix}_rush`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `explosive${suffix}_rush_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `explosive${suffix}_rush`)) * 100, 2, 1)}%` }, 
        { title: 'Non-Expl EPA/Play', key: `nonExplosiveEpaPerPlay${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `nonExplosiveEpaPerPlay${suffix}_rank`)), 134), value: roundNumber(retrieveValue(breakdown, `nonExplosiveEpaPerPlay${suffix}`), 2, 2) },
        { title: 'Pass EPA/Play', key: `EPAplay${suffix}_pass`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `EPAplay${suffix}_pass_rank`)), 134), value: roundNumber(retrieveValue(breakdown, `EPAplay${suffix}_pass`), 2, 2) }, 
        { title: 'Yds/DB', key: `yardsplay${suffix}_pass`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `yardsplay${suffix}_pass_rank`)), 134), value: roundNumber(retrieveValue(breakdown, `yardsplay${suffix}_pass`), 2, 2) }, 
        { title: 'Pass SR%', key: `success${suffix}_pass`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `success${suffix}_pass_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `success${suffix}_pass`)) * 100, 2, 1)}%` }, 
        { title: 'Havoc %', key: `havoc${suffix}`, percentile: generatePercentile(parseFloat(retrieveValue(breakdown, `havoc${suffix}_rank`)), 134), value: `${roundNumber(parseFloat(retrieveValue(breakdown, `havoc${suffix}`)) * 100, 2, 1)}%` }, 
    ];
    return base
}

export function generateRadarDataset(breakdowns: any[], titleKey: string, opponentKey: string | null = null, isDarkMode: boolean = false): ChartData<'radar'> {
    const sample = generateRadarPercentiles({}, titleKey);
    opponentKey = opponentKey || titleKey;
    
    const teamColors = breakdowns.map(b => {
        return { alternateColor: b.alternateColor, color: b.color }
    })

    const compColor = (isDarkMode) ? hexToRgb("#000000")! : hexToRgb("#FFFFFF")!

    const adjTeamColors = (teamColors.length > 1) ? adjustTeamColorsForContrast(teamColors[0], teamColors[1]) : [adjustColorForContrast(hexToRgb(teamColors[0].color) || hexToRgb(STANDARD_THEME_COLOR)!, hexToRgb(teamColors[0].alternateColor) || hexToRgb(STANDARD_THEME_COLOR)!, compColor)]

    return {
        labels: sample.map(p => p.title),
        datasets: breakdowns.map((b, i) => {
            const key = (i % 2) == 0 ? titleKey : opponentKey;
            const teamPercentilesDataset = generateRadarPercentiles(b, key)
            const teamColor = adjTeamColors[i];

            const teamTitle = b.season ? `${b.season} ${cleanField(b, "teamName")}` : cleanField(b, "teamName")

            return {
                labels: teamPercentilesDataset.map(p => `${teamTitle} - Raw: ${p.value}`),
                label: teamTitle,
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

export function generateRadarConfig(data: ChartData<'radar'>, title: string, isDarkMode: boolean = true, showLegend: boolean = false): ChartConfiguration<'radar'> {
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
                legend: {
                    display: showLegend
                },
                tooltip: {
                    callbacks: {
                        title: (contexts) => {
                            const ctx = contexts[0];
                            return ctx.label;
                        },
                        label: (context) => {
                            return `${context.dataset.label}: ${getNumberWithOrdinal(context.parsed.r)} %tile`
                        }
                    }
                }
            },
            responsive: true,
            elements: {
                line: {
                    borderWidth: 3
                }
            },
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
                        backdropColor: (isDarkMode) ? 'rgb(56, 61, 63)' : 'rgba(255, 255, 255, 0.75)',
                        color: (isDarkMode) ? '#e8e6e3' : '#525252'
                    },
                    pointLabels: {
                        color: (isDarkMode) ? '#e8e6e3' : '#525252'
                    }
                }
            }
        },
    }
}