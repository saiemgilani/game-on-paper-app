// import Chart, { type ChartConfiguration } from 'chart.js/auto';
// import { BoxPlotController, BoxAndWiskers } from '@sgratzl/chartjs-chart-boxplot';
import type { SeasonPercentile } from './summary';
import { SPECIAL_IMAGES } from '../utils/constants';
// Chart.register(BoxPlotController, BoxAndWiskers);

export interface MetricDistribution {
    min?: number,
    q1?: number,
    median?: number,
    q3?: number,
    max?: number,
    // outliers: number[]
}

function buildTeamChartData(teams: { season: number, team: string, teamId: string }[] = [], color: string | null, percentiles: SeasonPercentile[], category: string, metric: string) {
    const imageSize = getImageSizeForViewport();
    // console.log(percentiles)
    let distributions: Record<string, MetricDistribution> = {};
    for (const p of percentiles) {
        if (!Object.keys(distributions).includes(`${p["season"]}`)) {
            distributions[p["season"]] = {}
        }

        const pctl = p["pctile"]

        if (pctl <= 0.01) {
            // console.log(`adding min to ${p["season"]}`)
            distributions[p["season"]]["min"] = p["value"]
        } else if (pctl == 0.25) {
            // console.log(`adding q1 to ${p["season"]}`)
            distributions[p["season"]]["q1"] = p["value"]
        } else if (pctl == 0.5) {
            // console.log(`adding mdn to ${p["season"]}`)
            distributions[p["season"]]["median"] = p["value"]
        } else if (pctl == 0.75) {
            // console.log(`adding q3 to ${p["season"]}`)
            distributions[p["season"]]["q3"] = p["value"]
        } else if (pctl >= 0.99) {
            // console.log(`adding max to ${p["season"]}`)
            distributions[p["season"]]["max"] = p["value"]
        }
    }


    var seasons = Object.keys(distributions).map(p => parseInt(p)).sort((a,b) => (a - b))
    if (seasons.length == 0 && teams.length > 0) {
        seasons = teams.map(t => t["season"]).sort((a, b) => (a - b))
    }

    let composite: Record<string, { season: number, distribution: MetricDistribution, data?: { x: number, y: number } }> = {};
    for (const s of seasons) {
        const data: any = teams.find(t => t["season"] == s)

        composite[s] = {
            "season": s,
            "distribution": distributions[s]
        }

        if (data) {
            composite[s]["data"] = {
                x: data?.season || s,
                y: retrieveValue(data[category], metric) || null
            }
        }
    }

    const metricTitle = getAxisTitleForMetric(category, metric)
    const isRateMetric = metricTitle.includes("Rate")
    const hasAvailableDistributions = Object.values(distributions).find(v => v.min != null) !== undefined;
    
    let datasets = []

    if (teams.length > 0) {
        const teamName = teams.map(p => p.team)[0]
        const teamId = teams.map(p => p.teamId)[0]
        let img = new Image(imageSize, imageSize)
        if (Object.keys(SPECIAL_IMAGES).includes(teamId)) {
            img.src = SPECIAL_IMAGES[teamId];
        } else {
            img.src = (isDarkMode) ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${teamId}.png` : `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`
        }

        const publishedData = seasons.map(p => {
            const element = composite[p]
            if (!element) {
                return null
            }
            if (!element.data) {
                return null
            }

            return {
                label: `${teamName} - ${metricTitle}: ${formatNumberForMetric(metric, element.data.y)}`,
                data: element.data,
                pointStyle: img,
            }
        })
        datasets.push(
            {
                labels: publishedData.map(d => d?.label),
                label: teamName,
                type: "line",
                data: publishedData.map(d => d?.data),
                borderColor: color,
                pointBackgroundColor: color,
                showLine: false,
                fill: false,
                pointStyle: publishedData.map(d => d?.pointStyle),
                pointSize: imageSize,
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
                labels: seasons.map(p => {
                    const element = composite[p]
                    const dist = element?.distribution;
                    if (!dist) {
                        return null;
                    }
                    return `National Distribution - Min: ${formatNumberForMetric(metric, dist.min)}, Q1: ${formatNumberForMetric(metric, dist.q1)}, Median: ${formatNumberForMetric(metric, dist.median)}, Q3: ${formatNumberForMetric(metric, dist.q3)}, Max: ${formatNumberForMetric(metric, dist.max)}`
                }),
                backgroundColor: "rgb(35, 148, 253, 0.25)",
                hoverBorderColor: "rgba(35, 148, 253, 0.5)",
                borderColor: "rgb(35, 148, 253)",
                data: seasons.map(s => {
                    const element = composite[s];
                    const dist = element?.distribution;
                    if (!dist) {
                        return null;
                    }
                    let pctDict: Record<string, number> = {};
                    for (const [k, v] of Object.entries(dist)) {
                        pctDict[k] = v * (isRateMetric ? 100.0 : 1.0)
                    }
                    return pctDict;
                }),
            }
        )
    }

    return {
        labels: seasons,
        datasets
      }

}
