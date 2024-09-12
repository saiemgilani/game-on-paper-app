const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
const specialImages = {
    "61": "/assets/img/ennui-uga.png",
    "52": "/assets/img/fsu-face-52.png",
};
const imageSize = 37.5;

function roundNumber(value, power10, fixed) {
    return (Math.round(parseFloat(value || 0) * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
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
    
Chart.plugins.register([
    {
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
                chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                chart.ctx.fillText("Adj EPA/Play methodology adapted from Makenna Hack (@makennahack). Chart idea adapted from Bud Davis (@jbuddavis).", sizeWidth - (imgSize * 0.5) - 5, 7.1 * (sizeHeight / 8))
                chart.ctx.fillText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran) and Saiem Gilani (@saiemgilani)", sizeWidth - (imgSize * 0.5) - 5, 7.25 * (sizeHeight / 8))
                chart.ctx.restore();
            }
        },
        beforeDraw: (chart) => {
            let viewport = getCurrentViewport()
            if (viewport == "xl" || viewport == "lg") {
                let sizeWidth = chart.ctx.canvas.clientWidth;
                let sizeHeight = chart.ctx.canvas.clientHeight;
                let imgSize = 25.0;
                /* good/bad labels*/
                chart.ctx.save()
                chart.ctx.textAlign = "right"
                chart.ctx.font = "italic 10px Helvetica";
                chart.ctx.globalAlpha = 0.75;
                chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                chart.ctx.fillText("Good Offense, Good Defense", sizeWidth - (imgSize * 0.5) - 10, 3.75 * (sizeHeight / 8))
                chart.ctx.fillText("Good Offense, Bad Defense", sizeWidth - (imgSize * 0.5) - 10, 4.15 * (sizeHeight / 8))
                chart.ctx.restore();

                chart.ctx.save()
                chart.ctx.textAlign = "left"
                chart.ctx.font = "italic 10px Helvetica";
                chart.ctx.globalAlpha = 0.75;
                chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                chart.ctx.fillText("Bad Offense, Good Defense", (sizeWidth * 0.075) - 5, 3.75 * (sizeHeight / 8))
                chart.ctx.fillText("Bad Offense, Bad Defense", (sizeWidth * 0.075) - 5, 4.15 * (sizeHeight / 8))
                chart.ctx.restore();
    


            }
        }
    }
]);

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
                    y: -1
                },
                {
                    x: averageX,
                    y: 1
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
                    x: -1,
                    y: averageY,
                },
                {
                    x: 1,
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
    return {
        type: 'scatter',
        data: buildData(teams),
        options: {

            legend: false,
            responsive: true,
            title: {
                display: true,
                text: title,
                fontColor: (isDarkMode) ? "white" : "black",
                fontSize: 18,
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
                        min: -0.8,
                        max: 0.8
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
                        min: -0.8,
                        max: 0.8
                    }
                }]
            }
        }
    }
}