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

    const data = teams.map(t => {
        return {
            x: t["season"],
            y: retrieveValue(t[type], metric)
        }
    })
    
    const images = teams.map(t => {
        let img = new Image(imageSize, imageSize)
        if (Object.keys(specialImages).includes(t.teamId)) {
            img.src = specialImages[t.teamId];
        } else {
            img.src = (isDarkMode) ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${t.teamId}.png` : `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.teamId}.png`
        }
        return img;
    })


    const TREND_FUNCTION = d3.regressionLoess().bandwidth(0.45) // 0.75 matches ggplot/stats::loess default span param
    const trend = TREND_FUNCTION(data.map(d => [d.x, d.y]))
    // console.log(trend)

    let datasets = [
        {
            labels: data.map(p => `Season: ${p.x}, Value: ${roundNumber(p.y, 2, 2)}`),
            label: teams.map(p => p.team)[0],
            type: "line",
            data,
            borderColor: color,
            pointBackgroundColor: color,
            showLine: false,
            fill: false,
            pointStyle: images,
            pointSize: imageSize,
        },
        {
            type: "line",
            labels: trend.map(p => "Team Trend"),//trend.map(p => `Season: ${p[0]}, Team Trend (LOESS): ${roundNumber(p[1], 2, 2)}`),
            label: 'Team trend',
            data: trend.map(d =>  {
                return {
                    x: d[0],
                    y: d[1]
                }
            }),
            borderDash: [5, 15],
            borderColor: "rgb(35, 148, 253)", // color,
            pointBorderColor: "rgba(0,0,0,0)",
            pointBackgroundColor: "rgba(0,0,0,0)",
            showLine: true,
            fill: false,
            clip: true
        }
    ]

    if (percentiles.length > 0) {
        datasets.push(
            {
                type: "line",
                labels: percentiles.map(p => `Season: ${p["season"]}, National Avg: ${roundNumber(p["value"], 2, 2)}`),
                label: 'National Avg',
                data: percentiles.map(p => {
                    return {
                        x: p["season"],
                        y: p["value"]
                    }
                }),
                borderDash: [5, 15],
                borderColor: "red",
                pointBorderColor: "red",//"rgba(0,0,0,0)",
                pointBackgroundColor: "red",//"rgba(0,0,0,0)",
                showLine: true,
                fill: false,
                clip: true
            }
        )
    }

    return {
        datasets
    };
}

function generateTeamChartConfig(title, color, teams, percentiles, type, metric) {
    const chartData = buildTeamChartData(teams, color, percentiles, type, metric);
    const seasons = teams.map(d => parseInt(d.season)).sort()
    const yearRange = seasons.length > 1 ? `${seasons[0]} to ${seasons[seasons.length - 1]}` : `${seasons[0]}`

    const suggestedRange = {
        min: {
            x: seasons[0],
            // y: chartData.datasets[1].data[0].y,
        },
        max: {
            x: seasons[seasons.length - 1],
            // y: chartData.datasets[1].data[1].y
        }
    }
    const margin = 0.075
    const baseMultiplier = 0.475
    const lineMultiplier = 0.125
    const xAdjust = 0.06

    return {
        type: 'scatter',
        data: chartData,
        plugins: [{
            id: "captions-plugin",
            afterDraw: (chart) => {
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
                        chart.ctx.fillText("Chart idea adapted from Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
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
                }
            },
        }],
        options: {
            legend: {
                display: true,
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
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                        zeroLineColor: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                    },
                    type: 'linear',
                    position: 'bottom',
                    ticks: {
                        min: suggestedRange.min.x,
                        max: suggestedRange.max.x
                    }
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
                        color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                        zeroLineColor: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                    },
                    type: 'linear',
                    position: 'left',
                    ticks: {
                        reverse: (type == "defensive" && !["overall.havocRate", "rushing.stuffedPlayRate", "overall.thirdDownDistance"].includes(metric)) | (type == "offensive" && ["rushing.stuffedPlayRate", "overall.havocRate", "overall.thirdDownDistance"].includes(metric)),
                        min: suggestedRange.min.y,
                        max: suggestedRange.max.y
                    }
                }]
            }
        }
    }
}