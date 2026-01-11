function capitalizeFirstLetter(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

function getAxisTitleForMetric(type, metric) {
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

    if (type == "differential") {
        metricTitle = `Net ${metricTitle}`
    } else {
        metricTitle = `${capitalizeFirstLetter(type.slice(0, 3))} ${metricTitle}`
    }
    return metricTitle
}

function getTitleForMetric(type, metric) {
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

    if (type == "differential") {
        metricTitle = `Net ${metricTitle}`
    } else {
        metricTitle = `${capitalizeFirstLetter(type.slice(0, 3))} ${metricTitle}`
    }
    return metricTitle
}

function roundNumber(value, power10, fixed) {
    return (Math.round(parseFloat(value || 0) * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
}

function formatNumberForMetric(metric, value) {
    switch (metric) {
        case "overall.adjEpaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "overall.epaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "overall.yardsPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "overall.successRate": 
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "passing.epaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "passing.yardsPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "passing.successRate": 
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "rushing.epaPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "rushing.yardsPerPlay": 
            return `${roundNumber(value, 2, 2)}`;
        case "rushing.successRate": 
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "overall.havocRate": 
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "passing.explosiveRate":
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "rushing.explosiveRate":
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "rushing.opportunityRate":
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "rushing.lineYards":
            return `${roundNumber(value, 2, 2)}`;
        case "rushing.stuffedPlayRate":
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "overall.explosiveRate":
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "overall.nonExplosiveEpaPerPlay":
            return `${roundNumber(value, 2, 2)}`;
        case "overall.earlyDownEPAPerPlay":
            return `${roundNumber(value, 2, 2)}`;
        case "overall.lateDownSuccessRate":
            return `${roundNumber(parseFloat(100.0 * value), 2, 0)}%`
        case "overall.thirdDownDistance":
            return `${roundNumber(value, 2, 2)}`;
        default:
            return `${roundNumber(value, 2, 2)}`;
    }
}

function translateValue(input, inMin, inMax, outMin, outMax) {
    const leftRange = inMax - inMin;
    const rightRange = outMax - outMin;
    const scaledValue = (input - inMin) / leftRange;
    return outMin + (scaledValue * rightRange);
}

function retrieveValue(dictionary, key) {
    const subKeys = key.split('.')
    let sub = dictionary;
    for (const k of subKeys) {
        sub = sub[k];
    }
    return sub;
}

function getCurrentViewport() {
// https://stackoverflow.com/a/8876069
    const width = Math.max(
        document.documentElement.clientWidth,
        window.innerWidth || 0
    )
    if (width <= 576) return 'xs'
    if (width <= 768) return 'sm'
    if (width <= 992) return 'md'
    if (width <= 1200) return 'lg'
    return 'xl'
}

function getImageSizeForViewport(viewport = getCurrentViewport()) {
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


function getTitleSizeForViewport(viewport = getCurrentViewport()) {
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

function getAxisTitleSizeForViewport(viewport = getCurrentViewport()) {
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

function buildTeamChartData(teams, color, percentiles, type, metric) {
    const imageSize = getImageSizeForViewport();
    // console.log(percentiles)
    let distributions = {};
    for (const p of percentiles) {
        if (!Object.keys(distributions).includes(`${p["season"]}`)) {
            distributions[p["season"]] = {
                min: null,
                q1: null,
                median: null,
                q3: null,
                max: null,
                outliers: [],
            }
        }

        const pctl = parseFloat(p["pctile"])

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
    const metricTitle = getAxisTitleForMetric(type, metric)
    const isRateMetric = metricTitle.includes("Rate")
    const hasAvailableDistributions = Object.values(distributions).find(v => v.min != null) !== undefined;
    
    let datasets = []

    if (teams.length > 0) {
        const data = teams.map(t => {
            return {
                x: t["season"],
                y: retrieveValue(t[type], metric)
            }
        }).sort((a, b) => (a.x - b.x))

        const images = teams.map(t => {
            let img = new Image(imageSize, imageSize)
            if (Object.keys(specialImages).includes(t.teamId)) {
                img.src = specialImages[t.teamId];
            } else {
                img.src = (isDarkMode) ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${t.teamId}.png` : `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.teamId}.png`
            }
            return img;
        })
        const teamName = teams.map(p => p.team)[0]
        datasets.push(
            {
                labels: data.map(p => `${teamName} - ${metricTitle}: ${formatNumberForMetric(metric, p.y)}`),
                label: teamName,
                type: "line",
                data: data.map(p => {
                    return {
                        x: p.x,
                        y: p.y * (isRateMetric ? 100.0 : 1.0)
                    }
                }),
                borderColor: color,
                pointBackgroundColor: color,
                showLine: false,
                fill: false,
                pointStyle: images,
                pointSize: imageSize,
            }
        )

        if (percentiles.length == 0) {
            const TREND_FUNCTION = d3.regressionLoess().bandwidth(0.45) // 0.75 matches ggplot/stats::loess default span param
            const trend = TREND_FUNCTION(data.map(d => [d.x, d.y]))

            datasets.push(
                {
                    type: "line",
                    labels: trend.map(p => "Team Trend"),//trend.map(p => `Season: ${p[0]}, Team Trend (LOESS): ${roundNumber(p[1], 2, 2)}`),
                    label: 'Team Trend',
                    data: trend.map(d =>  {
                        return {
                            x: d[0],
                            y: d[1]
                        }
                    }),
                    borderDash: [5, 15],
                    borderColor: color,
                    pointBorderColor: "rgba(0,0,0,0)",
                    pointBackgroundColor: "rgba(0,0,0,0)",
                    showLine: true,
                    fill: false,
                    clip: true
                }
            )
        
        }
    }

    if (hasAvailableDistributions) {
        datasets.push(
            {
                label: 'National Distribution',
                type: 'boxplot',
                labels: seasons.map(p => {
                    const dist = distributions[p];
                    if (!dist) {
                        return null;
                    }
                    return `National Distribution - Min: ${formatNumberForMetric(metric, dist.min)}, Q1: ${formatNumberForMetric(metric, dist.q1)}, Median: ${formatNumberForMetric(metric, dist.median)}, Q3: ${formatNumberForMetric(metric, dist.q3)}, Max: ${formatNumberForMetric(metric, dist.max)}`
                }),
                backgroundColor: "rgb(35, 148, 253, 0.25)",
                hoverBorderColor: "rgba(35, 148, 253, 0.5)",
                borderColor: "rgb(35, 148, 253)",
                data: seasons.map(s => {
                    const dist = distributions[s];
                    if (!dist) {
                        return null;
                    }
                    return {
                        min: dist.min * (isRateMetric ? 100.0 : 1.0),
                        q1: dist.q1 * (isRateMetric ? 100.0 : 1.0),
                        median: dist.median * (isRateMetric ? 100.0 : 1.0),
                        q3: dist.q3 * (isRateMetric ? 100.0 : 1.0),
                        max: dist.max * (isRateMetric ? 100.0 : 1.0),
                        outliers: [],
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

function generateTeamChartConfig(title, color, teams, percentiles, type, metric) {
    const chartData = buildTeamChartData(teams, color, percentiles, type, metric);
    let seasons = percentiles.map(d => parseInt(d.season)).sort((a, b) => (a - b))
    if (seasons.length == 0 && teams.length > 0) {
        seasons = teams.map(t => t["season"]).sort((a, b) => (a - b))
    }
    const yearRange = seasons.length > 1 ? `${seasons[0]} to ${seasons[seasons.length - 1]}` : `${seasons[0]}`

    const margin = 0.075
    const baseMultiplier = 0.475
    const lineMultiplier = 0.125
    const xAdjust = 0.06

    const xGridLineColor = (isDarkMode) ? "#8D8D8D99" : "#E5E5E5"
    const yGridLineColor = (isDarkMode) ? "#8D8D8D33" : "#E5E5E599"
    const yZeroLineColor = (isDarkMode) ? "#8D8D8D" : "#AAAAAA"

    const shouldFlipYAxis = (type == "defensive" && !["overall.havocRate", "rushing.stuffedPlayRate", "overall.thirdDownDistance"].includes(metric)) || (type == "offensive" && ["rushing.stuffedPlayRate", "overall.havocRate", "overall.thirdDownDistance"].includes(metric))

    return {
        type: 'boxplot',
        data: chartData,
        plugins: [{
            id: "captions-plugin",
            beforeDatasetsDraw: (chart) => {
                let viewport = getCurrentViewport()
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
            legend: {
                display: (chartData.datasets.length > 1),
                position: "top"
            },
            responsive: true,
            title: {
                display: true,
                text: `${title} - ${getTitleForMetric(type, metric)} - ${yearRange}`,
                fontColor: (isDarkMode) ? "white" : "black",
                fontSize: getTitleSizeForViewport(),
                fontFamily: '"Chivo", "Fira Mono", serif'
            },
            tooltips: {
                callbacks: {
                    title: function(tooltipItem, data) {
                        return data.labels ? data.labels[tooltipItem[0].index] : null;
                    },
                    label: function(tooltipItem, data) {
                        const labels = data.datasets[tooltipItem.datasetIndex].labels
                        if (labels) {
                            return data.datasets[tooltipItem.datasetIndex].labels[tooltipItem.index]
                        }
                        return null;                        
                    }
                }
            },
            scales: {
                xAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: "Season",
                        fontColor: (isDarkMode) ? '#e8e6e3' : '#525252',
                        fontSize: getAxisTitleSizeForViewport(),
                        fontStyle: "oblique",
                        fontFamily: '"Chivo", "Fira Mono", serif'
                    },
                    gridLines: {
                        color: xGridLineColor,
                        zeroLineColor: xGridLineColor,
                    },
                    position: 'bottom',
                }],
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: getAxisTitleForMetric(type, metric),
                        fontColor: (isDarkMode) ? '#e8e6e3' : '#525252',
                        fontSize: getAxisTitleSizeForViewport(),
                        fontStyle: "oblique",
                        fontFamily: '"Chivo", "Fira Mono", serif'
                    },
                    gridLines: {
                        color: yGridLineColor,
                        zeroLineColor: (metric.includes("adjEpaPerPlay")) ? yZeroLineColor : yGridLineColor,
                    },
                    position: 'left',
                    ticks: {
                        reverse: shouldFlipYAxis,
                    }
                }]
            }
        }
    }
}