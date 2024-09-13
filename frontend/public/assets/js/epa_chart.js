const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
const specialImages = {
    "61": "/assets/img/ennui-uga.png",
    "52": "/assets/img/fsu-face-52.png",
};
const imageSize = 37.5;

function roundNumber(value, power10, fixed) {
    return (Math.round(parseFloat(value || 0) * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
}

function translateValue(input, inMin, inMax, outMin, outMax) {
    const leftRange = inMax - inMin;
    const rightRange = outMax - outMin;
    const scaledValue = (input - inMin) / leftRange;
    return outMin + (scaledValue * rightRange);
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

function buildData(base) {
    const data = base.map(t => {
        return {
            x: t.adjOffEpa,
            y: t.adjDefEpa
        }
    })
    const images = base.map(t => {
        let img = new Image(imageSize, imageSize)
        if (Object.keys(specialImages).includes(t.teamId)) {
            img.src = specialImages[t.teamId];
        } else {
            img.src = (isDarkMode) ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${t.teamId}.png` : `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.teamId}.png`
        }
        return img;
    })
    const names = base.map(p => p.team)
    const labels = base.map(p => `Off: ${roundNumber(p.adjOffEpa, 2, 2)}, Def: ${roundNumber(p.adjDefEpa, 2, 2)}`)

    const averageX = (data.map(t => parseFloat(t.x)).reduce((a, b) => a + b)) / data.length
    const minX = Math.min(...data.map(t => t.x))
    const maxX = Math.max(...data.map(t => t.x))
    const averageY = (data.map(t => parseFloat(t.y)).reduce((a, b) => a + b)) / data.length
    const minY = Math.min(...data.map(t => t.y))
    const maxY = Math.max(...data.map(t => t.y))
    console.log(`X: avg - ${averageX}, min - ${minX}, max - ${maxX}`)
    console.log(`Y: avg - ${averageY}, min - ${minY}, max - ${maxY}`)

    const suggestedRange = {
        min: {
            x: parseFloat(roundNumber(minX, 1, 1)) - 0.1,
            y: parseFloat(roundNumber(minY, 1, 1)) - 0.1,
        },
        max: {
            x: parseFloat(roundNumber(maxX, 1, 1)) + 0.1,
            y: parseFloat(roundNumber(maxY, 1, 1)) + 0.1
        }
    }

    const datasets = [
        {
            label: labels,
            data,
            borderColor: "black",
            pointBackgroundColor: "black",
            showLine: false,
            pointStyle: images,
            pointSize: imageSize,
        },
        {
            label: 'Avg X',
            data: [
                {
                    x: averageX,
                    y: suggestedRange.min.y
                },
                {
                    x: averageX,
                    y: suggestedRange.max.y
                }
            ],
            borderDash: [5, 15],
            borderColor: "red",
            pointBorderColor: "rgba(0,0,0,0)",
            pointBackgroundColor: "rgba(0,0,0,0)",
            showLine: true,
            clip: true
        },
        {
            label: 'Avg Y',
            data: [
                {
                    x: suggestedRange.min.x,
                    y: averageY,
                },
                {
                    x: suggestedRange.max.x,
                    y: averageY,
                }
            ],
            borderDash: [5, 15],
            borderColor: "red",
            pointBorderColor: "rgba(0,0,0,0)",
            pointBackgroundColor: "rgba(0,0,0,0)",
            showLine: true,
            clip: true
        }
    ]

    return {
        labels: names,
        datasets
    };
}

function generateConfig(title, teams) {
    const chartData = buildData(teams);

    const suggestedRange = {
        min: {
            x: chartData.datasets[2].data[0].x,
            y: chartData.datasets[1].data[0].y,
        },
        max: {
            x: chartData.datasets[2].data[1].x,
            y: chartData.datasets[1].data[1].y
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
                    let imgSize = 25.0;

                    /* credit */
                    chart.ctx.save()
                    chart.ctx.textAlign = "right"
                    chart.ctx.font = "8px Helvetica";
                    chart.ctx.globalAlpha = 0.75;
                    chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                    chart.ctx.fillText("Adj EPA/Play methodology adapted from Makenna Hack (@makennahack) and Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8))
                    chart.ctx.fillText("Chart idea adapted from Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
                    chart.ctx.restore();
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
            // move to corners
            beforeDatasetsDraw: (chart) => {
                let viewport = getCurrentViewport()
                if (viewport == "xl" || viewport == "lg") {
                    const sizeWidth = chart.ctx.canvas.clientWidth;
                    const sizeHeight = chart.ctx.canvas.clientHeight;
        
                    /* good/bad labels*/
                    chart.ctx.save()
                    chart.ctx.textAlign = "right"
                    chart.ctx.font = "italic 12px Helvetica";
                    chart.ctx.globalAlpha = 0.5;
                    chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                    chart.ctx.fillText("Good Offense, Good Defense", sizeWidth * (1 - margin + xAdjust), sizeHeight * margin)
                    chart.ctx.fillText("Good Offense, Bad Defense", sizeWidth * (1 - margin + xAdjust), sizeHeight * (1 - margin - 0.005))
                    chart.ctx.restore();
        
                    chart.ctx.save()
                    chart.ctx.textAlign = "left"
                    chart.ctx.font = "italic 12px Helvetica";
                    chart.ctx.globalAlpha = 0.5;
                    chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                    chart.ctx.fillText("Bad Offense, Good Defense", sizeWidth * (margin - 0.02), sizeHeight * margin)
                    chart.ctx.fillText("Bad Offense, Bad Defense", sizeWidth * (margin - 0.02), sizeHeight * (1 - margin - 0.005))
                    chart.ctx.restore();
                }
            }
        }],
        options: {
            legend: false,
            responsive: true,
            title: {
                display: true,
                text: title,
                fontColor: (isDarkMode) ? "white" : "black",
                fontSize: 20,
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
                        labelString: "Offense Adj EPA/Play",
                        fontColor: (isDarkMode) ? '#e8e6e3' : '#525252',
                        fontSize: 15,
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
                        labelString: "Defense Adj EPA/Play",
                        fontColor: (isDarkMode) ? '#e8e6e3' : '#525252',
                        fontSize: 15,
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
                        reverse: true,
                        min: suggestedRange.min.y,
                        max: suggestedRange.max.y
                    }
                }]
            }
        }
    }
}