<script lang="ts">
import Chart from 'chart.js/auto';
import { SDV_TEAM_PERCENT_COLUMNS, SPECIAL_IMAGES } from "../../utils/constants";
import type { ValueDistribution, ValuePercentile } from "../../resources/chart";
import { retrieveValue, getCurrentViewport, roundNumber, waitForElement, STANDARD_THEME_HOVER_RGBA, STANDARD_THEME_BACKGROUND_RGBA, STANDARD_THEME_COLOR, getImageSizeForViewport, formatNumberForMetric, getAxisTitleSizeForViewport, getTitleSizeForViewport, generateTeamMetricTitle, shouldInvertSortForMetric } from "../../utils/misc";
import type { SDVTeamSummary } from "../../resources/sdv";
import type { ChartConfiguration, ChartData, ChartDataset, ChartItem } from "chart.js";
import { BoxPlotController, BoxAndWiskers } from '@sgratzl/chartjs-chart-boxplot';

const { title, teamColor, teamData, category, metric, percentiles } = $props();

function buildTeamChartData(teams: SDVTeamSummary[], color: string | null, percentiles: ValuePercentile[], category: string, metric: string): ChartData<'boxplot' | 'line'> {
    let distributions: Record<number, ValueDistribution> = {};
    for (const p of percentiles) {
        if (!Object.keys(distributions).includes(`${p["season"]}`)) {
            distributions[p["season"]] = {
                min: null,
                q1: null,
                median: null,
                q3: null,
                max: null,
            }
        }

        if (p.pctile <= 0.01) {
            // console.log(`adding min to ${p["season"]}`)
            distributions[p["season"]].min = p.value
        } else if (p.pctile == 0.25) {
            // console.log(`adding q1 to ${p["season"]}`)
            distributions[p["season"]].q1 = p.value
        } else if (p.pctile == 0.5) {
            // console.log(`adding mdn to ${p["season"]}`)
            distributions[p["season"]].median = p.value
        } else if (p.pctile == 0.75) {
            // console.log(`adding q3 to ${p["season"]}`)
            distributions[p["season"]].q3 = p.value
        } else if (p.pctile >= 0.99) {
            // console.log(`adding max to ${p["season"]}`)
            distributions[p["season"]].max = p.value
        }
    }


    let seasons = Object.keys(distributions).map(p => parseInt(p)).sort((a,b) => (a - b))
    if (teams.length > seasons.length) {
        seasons = teams.map((t: SDVTeamSummary) => t.season).sort((a: number, b: number) => (a - b))
    }

    let composite: Record<number, {
        season: number
        distribution: ValueDistribution
        data?: { x: number, y: number | null } | null
    }> = {};
    for (const s of seasons) {
        const data = teams.find(t => String(t["season"]) == String(s))
        composite[s] = {
            "season": s,
            "distribution": distributions[s]
        }

        if (data) {
            const val = retrieveValue((data as any), metric) 
            console.log(metric)
            composite[s].data = {
                x: data?.season || s,
                y: (typeof(val) == "string" ? parseFloat(val) : val) || null
            }
        } else {
            composite[s].data = null
        }
    }

    const imageSize = getImageSizeForViewport(getCurrentViewport(document, window))
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const metricTitle = generateTeamMetricTitle(metric)
    const isRateMetric = SDV_TEAM_PERCENT_COLUMNS.includes(metric)
    const hasAvailableDistributions = Object.values(distributions).find(v => v.min != null) !== undefined;
    
    let datasets: ChartDataset<'boxplot' | 'line'>[] = []

    if (teams.length > 0) {
        const teamName = teams.map(p => p.pos_team)[0]
        const teamId = teams.map(p => p.team_id)[0]
        let img = new Image(imageSize, imageSize)
        if (Object.keys(SPECIAL_IMAGES).includes(String(teamId))) {
            img.src = SPECIAL_IMAGES[teamId];
        } else {
            img.src = (isDarkMode) ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${teamId}.png` : `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`
        }

        const publishedData = seasons.map(p => {
            const element = composite[p]
            if (!element) {
                return {
                    label: `${teamName} - ${metricTitle}: N/A`,
                    data: {
                        x: p,
                        y: null
                    },
                    pointStyle: img
                }
            }
            if (!element.data) {
                return {
                    label: `${teamName} - ${metricTitle}: N/A`,
                    data: {
                        x: p,
                        y: null
                    },
                    pointStyle: img
                }
            }

            return {
                label: `${teamName} - ${metricTitle}: ${formatNumberForMetric(metric, element.data.y || 0)}`,
                data: element.data,
                pointStyle: img,
            }
        }).filter(d => !!d).sort((a, b) => a.data.x - b.data.x)

        datasets.push(
            {
                label: teamName,
                type: "line",
                borderColor: color || STANDARD_THEME_HOVER_RGBA,
                data: publishedData.map(d => d.data.y),
                pointHoverBorderColor: color || STANDARD_THEME_HOVER_RGBA,
                pointHoverBackgroundColor: color || STANDARD_THEME_BACKGROUND_RGBA,
                pointBorderColor: color || STANDARD_THEME_HOVER_RGBA,
                pointBackgroundColor: color || STANDARD_THEME_BACKGROUND_RGBA,
                showLine: false,
                fill: false,
                pointStyle: publishedData.map(d => d.pointStyle),
                pointRadius: imageSize / 2,
            }
        )

        // if (percentiles.length == 0) {
        //     const TREND_FUNCTION = d3.regressionLoess().bandwidth(0.45) // 0.75 matches ggplot/stats::loess default span param
        //     const trend = TREND_FUNCTION(publishedData.filter(p => p.data != null).map(d => [d.data.x, d.data.y]))

        //     datasets.push(
        //         {
        //             type: "line",
        //             labels: trend.map(p => "Team Trend"),//trend.map(p => `Season: ${p[0]}, Team Trend (LOESS): ${roundNumber(p[1], 2, 2)}`),
        //             label: 'Team Trend',
        //             data: seasons.map(p => {
        //                 const element = trend.find(d => d[0] == p)
        //                 if (!element) {
        //                     return null;
        //                 }
        //                 return {
        //                     x: element[0],
        //                     y: element[1]
        //                 }
        //             }),
        //             borderDash: [5, 15],
        //             borderColor: color,
        //             pointBorderColor: "rgba(0,0,0,0)",
        //             pointBackgroundColor: "rgba(0,0,0,0)",
        //             showLine: true,
        //             fill: false,
        //             clip: true
        //         }
        //     )
        
        // }
    }

    if (hasAvailableDistributions) {
        datasets.push(
            {
                label: 'National Distribution',
                type: 'boxplot',
                backgroundColor: STANDARD_THEME_BACKGROUND_RGBA,
                hoverBorderColor: STANDARD_THEME_HOVER_RGBA,
                borderColor: STANDARD_THEME_COLOR,
                data: seasons.map(s => {
                    const element = composite[s];
                    const dist = element?.distribution;
                    if (!dist) {
                        return null;
                    }

                    return {
                        min: (dist.min || 0) * (isRateMetric ? 100.0 : 1.0),
                        q1: (dist.q1 || 0) * (isRateMetric ? 100.0 : 1.0),
                        median: (dist.median || 0) * (isRateMetric ? 100.0 : 1.0),
                        mean: (dist.median || 0) * (isRateMetric ? 100.0 : 1.0),
                        q3: (dist.q3 || 0) * (isRateMetric ? 100.0 : 1.0),
                        max: (dist.max || 0) * (isRateMetric ? 100.0 : 1.0),
                        whiskerMax: (dist.max || 0),
                        whiskerMin: (dist.min || 0)
                    }
                }),
            }
        )
    }

    return {
        labels: seasons,
        datasets
    }

}

function generateTeamChartConfig(title: string, color: string | null, teams: SDVTeamSummary[], percentiles: ValuePercentile[], category: string, metric: string): ChartConfiguration<'boxplot' | 'line'> {
    const chartData = buildTeamChartData(teams, color, percentiles, category, metric);
    let seasons = percentiles.map(d => d.season).sort((a, b) => (a - b))
    if (seasons.length == 0 && teams.length > 0) {
        seasons = teams.map(t => t["season"]).sort((a, b) => (a - b))
    }
    const yearRange = seasons.length > 1 ? `${seasons[0]} to ${seasons[seasons.length - 1]}` : `${seasons[0]}`

    const margin = 0.075
    const baseMultiplier = 0.475
    const lineMultiplier = 0.125
    const xAdjust = 0.06

    const viewport = getCurrentViewport(document, window);
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const shouldFlipYAxis = shouldInvertSortForMetric(category, metric);

    return {
        type: 'boxplot',
        data: chartData,
        plugins: [{
            id: "captions-plugin",
            beforeDatasetsDraw: (chart: any) => {
                if (viewport == "xl" || viewport == "lg") {
                    let sizeWidth = chart.ctx.canvas.clientWidth;
                    let sizeHeight = chart.ctx.canvas.clientHeight;

                    /* credit */
                    if (metric.includes("_adj_") || metric.startsWith("adj_")) {
                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "8px Helvetica";
                        chart.ctx.globalAlpha = 0.75;
                        chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText("Adj EPA/Play methodology adapted from Makenna Hack (@makennahack) and Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8))
                        // chart.ctx.fillText("LOESS regression used for team trend line.", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
                        chart.ctx.restore();
                    }
                    chart.ctx.save()
                    chart.ctx.textAlign = "left"
                    chart.ctx.font = "8px Helvetica";
                    chart.ctx.globalAlpha = 0.75;
                    chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                    chart.ctx.fillText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran)", sizeWidth * (margin - 0.02), (baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8))
                    chart.ctx.fillText("and Saiem Gilani (@saiemgilani).", sizeWidth * (margin - 0.02), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
                    chart.ctx.restore();

                    if (shouldFlipYAxis) {
                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "italic 8px Helvetica";
                        chart.ctx.globalAlpha = 0.5;
                        chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText("NOTE: y-axis is flipped to ensure 'good' performances are", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (lineMultiplier)) * (sizeHeight / 8)))
                        chart.ctx.fillText("towards the top and 'bad' performances are towards the bottom.", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8)))
                        chart.ctx.restore();
                    }
                }
            },
        }],
        options: {
            plugins: {
                    title: {
                    display: true,
                    text: `${title} - ${generateTeamMetricTitle(metric)} - ${yearRange}`,
                    color: (isDarkMode) ? "white" : "black",
                    font: {
                        size: getTitleSizeForViewport(viewport),
                        family: '"Chivo", "Fira Mono", serif'
                    },
                },
                legend: {
                    display: (chartData.datasets.length > 1),
                    position: "top"
                },
                tooltip: {
                    callbacks: {
                        title: (contexts: any) => {
                            return contexts[0].label;
                        },
                    }
                },
            },
            responsive: true,
            scales: {
                y: {
                    reverse: shouldFlipYAxis,
                    grid: {
                        color: (line) => {
                            if (line.tick.value == 0) {
                                return (isDarkMode) ? "#8D8D8D" : "#AAAAAA"
                            }
                            return (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                        },
                    },
                    title: {
                        display: true,
                        text: generateTeamMetricTitle(metric),
                        color: (isDarkMode) ? '#e8e6e3' : '#525252',
                        font: {
                            size: getAxisTitleSizeForViewport(viewport),
                            family: '"Chivo", "Fira Mono", serif',
                            style: "oblique"
                        }
                    },
                    ticks: {
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                    }
                },
                x: {
                    ticks: {
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                    },
                    title: {
                        display: true,
                        text: "Season",
                        color: (isDarkMode) ? '#e8e6e3' : '#525252',
                        font: {
                            size: getAxisTitleSizeForViewport(viewport),
                            family: '"Chivo", "Fira Mono", serif',
                            style: "oblique"
                        }
                    },
                    grid: {
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                    }
                }
            }
        }
    }
}

function generateChart(chartContext: HTMLElement | null) {
    Chart.register(BoxPlotController, BoxAndWiskers);
    // Stores the controller so that the chart initialization routine can look it up
    new Chart(
        chartContext as ChartItem,
        generateTeamChartConfig(title, teamColor, teamData, percentiles, category, metric)
    )
}

async function waitToGenerateChart() {
    try {
        const context = await waitForElement(document, "metric_chart_canvas")
        generateChart(context)
    } catch (e) {
        console.error(e);
        const container = document.getElementById("chart_container");
        if (container) {
            container.innerHTML = `<p class='m-0 mb-3 text-muted text-small'>Unable to generate chart. Please reach out to <a href="https://bsky.app/profile/akeaswaran.me">@akeaswaran.me</a> or <a href="https://bsky.app/profile/saiemgilani.bsky.social">@saiemgilani</a> on Bluesky with the page and chart options you're trying to access.</p>`
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

</script>
<div class="container" id="chart_container">
    <canvas id="metric_chart_canvas" class="mb-3" style="display: block; box-sizing: border-box; height: 1200px; width: 800px;"  width="1200" height="800"></canvas>
</div>