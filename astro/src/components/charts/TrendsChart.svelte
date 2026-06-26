<script lang="ts">
import Chart from 'chart.js/auto';
import { SPECIAL_IMAGES } from "../../utils/constants";
import type { ValueDistribution, ValuePercentile } from "../../resources/chart";
import { retrieveValue, getCurrentViewport, roundNumber, getNumberWithOrdinal, sleep, waitForElement } from "../../utils/misc";
import type { TeamSummary } from "../../resources/summary";
import type { ChartConfiguration, ChartData, ChartDataset, ChartItem } from "chart.js";
import { BoxPlotController, BoxAndWiskers } from '@sgratzl/chartjs-chart-boxplot';


const { category, metric, percentiles } = $props();

export function capitalizeFirstLetter(val: string): string {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

export function getAxisTitleForMetric(category: string, metric: string): string {
    var metricTitle = metric;
    switch (metric) {
        case "overall.adjEpaPerPlay": 
            metricTitle = "Adj EPA/Play";
            break;
        case "overall.epaPerPlay": 
            metricTitle = "EPA/Play";
            break;
        case "overall.yardsPerPlay": 
            metricTitle = "Yards/Play";
            break;
        case "overall.successRate": 
            metricTitle = "Success %";
            break;
        case "passing.epaPerPlay": 
            metricTitle = "EPA/DB";
            break;
        case "passing.yardsPerPlay": 
            metricTitle = "Yards/DB";
            break;
        case "passing.successRate": 
            metricTitle = "Pass SR%";
            break;
        case "rushing.epaPerPlay": 
            metricTitle = "EPA/Rush";
            break;
        case "rushing.yardsPerPlay": 
            metricTitle = "Yards/Rush";
            break;
        case "rushing.successRate": 
            metricTitle = "Rush SR%";
            break;
        case "overall.havocRate": 
            metricTitle = "Havoc %";
            break;
        case "passing.explosiveRate":
            metricTitle = "Pass Expl %";
            break;
        case "rushing.explosiveRate":
            metricTitle = "Rush Expl %";
            break;
        case "rushing.opportunityRate":
            metricTitle = "Opportunity %";
            break;
        case "rushing.lineYards":
            metricTitle = "Line Yards";
            break;
        case "rushing.stuffedPlayRate":
            metricTitle = "Stuffed %";
            break;
        case "overall.explosiveRate":
            metricTitle = "Explosive %";
            break;
        case "overall.nonExplosiveEpaPerPlay":
            metricTitle =  "Non-Expl EPA/Play";
            break;
        case "overall.earlyDownEPAPerPlay":
            metricTitle =  "Early Downs EPA/Play";
            break;
        case "overall.lateDownSuccessRate":
            metricTitle =  "Late Downs SR%";
            break;
        case "overall.thirdDownDistance":
            metricTitle =  "Avg Distance (3rd)";
            break;
        default:
            metricTitle = metric;
            break;
    }

    if (category == "differential") {
        metricTitle = `Net ${metricTitle}`
    } else {
        metricTitle = `${capitalizeFirstLetter(category.slice(0, 3))} ${metricTitle}`
    }
    return metricTitle
}

export function getTitleForMetric(category: string, metric: string): string {
    var metricTitle = metric;
    switch (metric) {
        case "overall.adjEpaPerPlay": 
            metricTitle = "Adj EPA/Play";
            break;
        case "overall.epaPerPlay": 
            metricTitle = "EPA/Play";
            break;
        case "overall.yardsPerPlay": 
            metricTitle = "Yards/Play";
            break;
        case "overall.successRate": 
            metricTitle = "Success Rate";
            break;
        case "passing.epaPerPlay": 
            metricTitle = "EPA/Dropback";
            break;
        case "passing.yardsPerPlay": 
            metricTitle = "Yards/Dropback";
            break;
        case "passing.successRate": 
            metricTitle = "Pass Success Rate";
            break;
        case "rushing.epaPerPlay": 
            metricTitle = "EPA/Rush";
            break;
        case "rushing.yardsPerPlay": 
            metricTitle = "Yards/Rush";
            break;
        case "rushing.successRate": 
            metricTitle = "Rush Success Rate";
            break;
        case "overall.havocRate": 
            metricTitle = "Havoc Rate";
            break;
        case "passing.explosiveRate":
            metricTitle = "Pass Explosive Play Rate";
            break;
        case "rushing.explosiveRate":
            metricTitle = "Rush Explosive Play Rate";
            break;
        case "rushing.opportunityRate":
            metricTitle = "Opportunity Rate";
            break;
        case "rushing.lineYards":
            metricTitle = "Line Yards/Rush";
            break;
        case "rushing.stuffedPlayRate":
            metricTitle = "Stuffed Run Rate";
            break;
        case "overall.explosiveRate":
            metricTitle = "Explosive Play Rate";
            break;
        case "overall.nonExplosiveEpaPerPlay":
            metricTitle =  "Non-Explosive EPA/Play";
            break;
        case "overall.earlyDownEPAPerPlay":
            metricTitle =  "Early Downs EPA/Play";
            break;
        case "overall.lateDownSuccessRate":
            metricTitle =  "Late Downs Success Rate";
            break;
        case "overall.thirdDownDistance":
            metricTitle =  "Avg Distance on 3rd Down";
            break;
        default:
            metricTitle = metric;
            break;
    }

    if (category == "differential") {
        metricTitle = `Net ${metricTitle}`
    } else {
        metricTitle = `${capitalizeFirstLetter(category.slice(0, 3))} ${metricTitle}`
    }
    return metricTitle
}

function formatNumberForMetric(metric: string, value: number): string {
    switch (metric) {
        case "overall.adjEpaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "overall.epaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "overall.yardsPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "overall.successRate": 
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "passing.epaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "passing.yardsPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "passing.successRate": 
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "rushing.epaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "rushing.yardsPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "rushing.successRate": 
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "overall.havocRate": 
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "passing.explosiveRate":
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "rushing.explosiveRate":
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "rushing.opportunityRate":
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "rushing.lineYards":
            return `${roundNumber(value, 2, 2)}`;
        case "rushing.stuffedPlayRate":
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "overall.explosiveRate":
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "overall.nonExplosiveEpaPerPlay":
            return `${roundNumber(value, 2, 2)}`;
        case "overall.earlyDownEPAPerPlay":
            return `${roundNumber(value, 2, 2)}`;
        case "overall.lateDownSuccessRate":
            return `${roundNumber((100.0 * value), 2, 0)}%`
        case "overall.thirdDownDistance":
            return `${roundNumber(value, 2, 2)}`;
        default:
            return `${roundNumber(value, 2, 2)}`;
    }
}


function getImageSizeForViewport(viewport: 'xs' | 'sm' | 'md' | 'lg' | 'xl'): number {
    switch (viewport) {
        case 'xs':
        case 'sm':
            return 25;
        case 'md':
        case 'lg':
        case 'xl':
            return 37.5;
    }
}


function getTitleSizeForViewport(viewport: 'xs' | 'sm' | 'md' | 'lg' | 'xl'): number {
    switch (viewport) {
        case 'xs':
        case 'sm':
            return 15;
        case 'md':
        case 'lg':
        case 'xl':
            return 20;
    }
}

function getAxisTitleSizeForViewport(viewport: 'xs' | 'sm' | 'md' | 'lg' | 'xl'): number {
    switch (viewport) {
        case 'xs':
        case 'sm':
            return 10
        case 'md':
        case 'lg':
        case 'xl':
            return 15;
    }
}

function buildTeamChartData(teams: TeamSummary[], color: string | null, percentiles: ValuePercentile[], category: string, metric: string): ChartData<'boxplot'> {
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
            distributions[p.season].q3 = p.value
        } else if (p.pctile >= 0.99) {
            // console.log(`adding max to ${p["season"]}`)
            distributions[p.season].max = p.value
        }
    }


    let seasons = Object.keys(distributions).map(p => parseInt(p)).sort((a,b) => (a - b))
    if (seasons.length == 0 && teams.length > 0) {
        seasons = teams.map((t: TeamSummary) => t.season).sort((a: number, b: number) => (a - b))
    }

    let composite: Record<number, {
        season: number
        distribution: ValueDistribution
        data?: { x: number, y: number | null } | null
    }> = {};
    for (const s of seasons) {
        const data = teams.find(t => t["season"] == s)

        composite[s] = {
            "season": s,
            "distribution": distributions[s]
        }

        if (data) {
            const val = retrieveValue((data as any)[category], metric) 
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
    const metricTitle = getAxisTitleForMetric(category, metric)
    const isRateMetric = metricTitle.includes("Rate")
    const hasAvailableDistributions = Object.values(distributions).find(v => v.min != null) !== undefined;
    
    let datasets: ChartDataset<'boxplot'>[] = []

    if (hasAvailableDistributions) {
        datasets.push(
            {
                label: 'National Distribution',
                type: 'boxplot',
                backgroundColor: "rgb(35, 148, 253, 0.25)",
                hoverBorderColor: "rgba(35, 148, 253, 0.5)",
                borderColor: "rgb(35, 148, 253)",
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
                    }
                }).filter(s => s != null),
            }
        )
    }

    return {
        labels: seasons,
        datasets
    }

}

function generateTeamChartConfig(title: string, color: string | null, teams: TeamSummary[], percentiles: ValuePercentile[], category: string, metric: string): ChartConfiguration<'boxplot'> {
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

    const shouldFlipYAxis = (category == "defensive" && !["overall.havocRate", "rushing.stuffedPlayRate", "overall.thirdDownDistance"].includes(metric)) || (category == "offensive" && ["rushing.stuffedPlayRate", "overall.havocRate", "overall.thirdDownDistance"].includes(metric))

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
                    if (metric.includes("adjEpaPerPlay")) {
                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "8px Helvetica";
                        chart.ctx.globalAlpha = 0.75;
                        chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText("Adj EPA/Play methodology adapted from Makenna Hack (@makennahack) and Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8))
                        chart.ctx.fillText("LOESS regression used for team trend line.", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
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
                    text: `${title} - ${getTitleForMetric(category, metric)} - ${yearRange}`,
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
                        text: getAxisTitleForMetric(category, metric),
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
        generateTeamChartConfig("National Trends", null, [], percentiles, category, metric)
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
            container.innerHTML = `<p class='mb-0 text-muted text-small'>Unable to generate chart.</p>`
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