const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
const specialImages = {
    "61": "/assets/img/ennui-uga.png",
    // "2390": "/assets/img/upside-down-u.png",
};

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

function buildData(teams, type, metric) {
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
    const names = teams.map(p => p.team)
    // const labels = teams.map(p => `Off: ${roundNumber(p.adjOffEpa, 2, 2)}, Def: ${roundNumber(p.adjDefEpa, 2, 2)}`)

    // const averageX = (data.map(t => parseFloat(t.x)).reduce((a, b) => a + b)) / data.length
    // const minX = Math.min(...data.map(t => t.x))
    // const maxX = Math.max(...data.map(t => t.x))
    const averageY = (data.map(t => parseFloat(t.y)).reduce((a, b) => a + b)) / data.length
    const minY = Math.min(...data.map(t => t.y))
    const maxY = Math.max(...data.map(t => t.y))
    // console.log(`X: avg - ${averageX}, min - ${minX}, max - ${maxX}`)
    console.log(`Y: avg - ${averageY}, min - ${minY}, max - ${maxY}`)

    const TREND_FUNCTION = d3.regressionLoess().bandwidth(0.45) // 0.75 matches ggplot/stats::loess default span param
    const trend = TREND_FUNCTION(data.map(d => [d.x, d.y]))
    // console.log(trend)

    const datasets = [
        {
            // label: labels,
            type: "line",
            data,
            borderColor: "black",
            pointBackgroundColor: "black",
            showLine: false,
            fill: false,
            pointStyle: images,
            pointSize: imageSize,
        },
        // {
        //     type: "line",
        //     label: 'Avg Y',
        //     data: [
        //         {
        //             x: seasons[0],
        //             y: averageY,
        //         },
        //         {
        //             x: seasons[seasons.length-1] + 1,
        //             y: averageY,
        //         }
        //     ],
        //     borderDash: [5, 15],
        //     borderColor: "red",
        //     pointBorderColor: "rgba(0,0,0,0)",
        //     pointBackgroundColor: "rgba(0,0,0,0)",
        //     showLine: true,
        //     fill: false,
        //     clip: true
        // },
        {
            type: "line",
            label: 'LOESS trend',
            data: trend.map(d =>  {
                return {
                    x: d[0],
                    y: d[1]
                }
            }),
            borderDash: [5, 15],
            borderColor: "rgb(35, 148, 253)",
            pointBorderColor: "rgba(0,0,0,0)",
            pointBackgroundColor: "rgba(0,0,0,0)",
            showLine: true,
            fill: false,
            clip: true
        }
    ]

    return {
        labels: names,
        datasets
    };
}

function generateConfig(title, teams, type, metric) {
    const chartData = buildData(teams, type, metric);
    const seasons = teams.map(d => parseInt(d.season)).sort()
    const yearRange = seasons.length > 1 ? `${seasons[0]} to ${seasons[seasons.length - 1]}` : `${seasons[0]}`

    // const suggestedRange = {
    //     min: {
    //         // x: chartData.datasets[2].data[0].x,
    //         y: chartData.datasets[1].data[0].y,
    //     },
    //     max: {
    //         // x: chartData.datasets[2].data[1].x,
    //         y: chartData.datasets[1].data[1].y
    //     }
    // }

    // const margin = 0.075
    // const baseMultiplier = 0.475
    // const lineMultiplier = 0.125
    // const xAdjust = 0.06

    return {
        type: 'scatter',
        data: chartData,
        // plugins: [{
        //     id: "captions-plugin",
        //     afterDraw: (chart) => {
        //         let viewport = getCurrentViewport()
        //         if (viewport == "xl" || viewport == "lg") {
        //             let sizeWidth = chart.ctx.canvas.clientWidth;
        //             let sizeHeight = chart.ctx.canvas.clientHeight;
        //             let imgSize = 25.0;

        //             /* credit */
        //             chart.ctx.save()
        //             chart.ctx.textAlign = "right"
        //             chart.ctx.font = "8px Helvetica";
        //             chart.ctx.globalAlpha = 0.75;
        //             chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
        //             chart.ctx.fillText("Adj EPA/Play methodology adapted from Makenna Hack (@makennahack) and Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8))
        //             chart.ctx.fillText("Chart idea adapted from Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
        //             chart.ctx.restore();
        //             chart.ctx.save()
        //             chart.ctx.textAlign = "left"
        //             chart.ctx.font = "8px Helvetica";
        //             chart.ctx.globalAlpha = 0.75;
        //             chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
        //             chart.ctx.fillText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran)", sizeWidth * (margin - 0.02), (baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8))
        //             chart.ctx.fillText("and Saiem Gilani (@saiemgilani).", sizeWidth * (margin - 0.02), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
        //             chart.ctx.restore();
        //         }
        //     },
        //     // move to corners
        //     beforeDatasetsDraw: (chart) => {
        //         let viewport = getCurrentViewport()
        //         if (viewport == "xl" || viewport == "lg") {
        //             const sizeWidth = chart.ctx.canvas.clientWidth;
        //             const sizeHeight = chart.ctx.canvas.clientHeight;

        //             /* good/bad labels*/
        //             chart.ctx.save()
        //             chart.ctx.textAlign = "right"
        //             chart.ctx.font = "italic 12px Helvetica";
        //             chart.ctx.globalAlpha = 0.5;
        //             chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
        //             chart.ctx.fillText("Good Offense, Good Defense", sizeWidth * (1 - margin + xAdjust), sizeHeight * margin)
        //             chart.ctx.fillText("Good Offense, Bad Defense", sizeWidth * (1 - margin + xAdjust), sizeHeight * (1 - margin - 0.005))
        //             chart.ctx.restore();

        //             chart.ctx.save()
        //             chart.ctx.textAlign = "left"
        //             chart.ctx.font = "italic 12px Helvetica";
        //             chart.ctx.globalAlpha = 0.5;
        //             chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
        //             chart.ctx.fillText("Bad Offense, Good Defense", sizeWidth * (margin - 0.02), sizeHeight * margin)
        //             chart.ctx.fillText("Bad Offense, Bad Defense", sizeWidth * (margin - 0.02), sizeHeight * (1 - margin - 0.005))
        //             chart.ctx.restore();
        //         }
        //     }
        // }],
        options: {
            legend: false,
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
                        return data.labels[tooltipItem[0].index]
                    },
                    label: function(tooltipItem, data) {
                        // console.log(tooltipItem)
                        // console.log(data)
                        return data.datasets[tooltipItem.datasetIndex].label[tooltipItem.index]
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
                    // ticks: {
                    //     reverse: true,
                    //     min: suggestedRange.min.y,
                    //     max: suggestedRange.max.y
                    // }
                }]
            }
        }
    }
}