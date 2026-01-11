function deltaE(rgbA, rgbB) {
    let labA = rgb2lab(rgbA);
    let labB = rgb2lab(rgbB);
    let deltaL = labA[0] - labB[0];
    let deltaA = labA[1] - labB[1];
    let deltaB = labA[2] - labB[2];
    let c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
    let c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
    let deltaC = c1 - c2;
    let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
    deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
    let sc = 1.0 + 0.045 * c1;
    let sh = 1.0 + 0.015 * c1;
    let deltaLKlsl = deltaL / (1.0);
    let deltaCkcsc = deltaC / (sc);
    let deltaHkhsh = deltaH / (sh);
    let i = deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
    return i < 0 ? 0 : Math.sqrt(i);
}

function rgb2lab(rgb){
    let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, x, y, z;
    r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    x = (x > 0.008856) ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
    y = (y > 0.008856) ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
    z = (z > 0.008856) ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
    return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)]
}

function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}


function adjustColor(primaryColor, altColor) {
    const compColor = (isDarkMode) ? hexToRgb("#000000") : hexToRgb("#FFFFFF")
    let dEBGTeam = deltaE([primaryColor.r, primaryColor.g, primaryColor.b], [compColor.r, compColor.g, compColor.b])
    let dEBGAlt = deltaE([altColor.r, altColor.g, altColor.b], [compColor.r, compColor.g, compColor.b])

    var teamColor = primaryColor;
    if (dEBGTeam > 49) {
        teamColor = primaryColor
        console.log(`set team color to primary ${JSON.stringify(primaryColor)} because no similarity to background`)
    } else if (dEBGTeam <= 49 && dEBGAlt > 49) {
        teamColor = altColor
        console.log(`set team color to alt ${JSON.stringify(altColor)} because of similarity to background`)
    } else if (dEBGTeam <= 49 && dEBGAlt <= 49) {
        teamColor = hexToRgb("#CCCCCC")
        console.log(`set team color to emergency ${JSON.stringify(teamColor)} because of both colors' similarity to background`)
    } else {
        teamColor = primaryColor
        console.log(`set team color to primary ${JSON.stringify(primaryColor)} because backup`)
    }
    return teamColor
}

function adjustTeamColors(awayTeam, homeTeam) {
    var awayTeamColor = hexToRgb(awayTeam.color)
    var homeTeamColor = hexToRgb(homeTeam.color)

    if (!homeTeamColor) {
        return [awayTeamColor, hexToRgb("#CCCCCC")]
    }

    if (!awayTeamColor) {
        return [hexToRgb("#CCCCCC"), homeTeamColor]
    }

    // if the homeTeamColor and the awayTeamColor are too similar, make the awayTeam use their alt
    let dEHome = deltaE([awayTeamColor.r, awayTeamColor.g, awayTeamColor.b], [homeTeamColor.r, homeTeamColor.g, homeTeamColor.b])
    if (dEHome <= 49 && awayTeam.alternateColor != null) {
        awayTeamColor = hexToRgb(awayTeam.alternateColor)
        console.log(`updating away team color from primary ${JSON.stringify(hexToRgb(awayTeam.color))} to alt: ${JSON.stringify(awayTeamColor)}`)
        if (deltaE([awayTeamColor.r, awayTeamColor.g, awayTeamColor.b], [homeTeamColor.r, homeTeamColor.g, homeTeamColor.b]) <= 49) {
            awayTeamColor = hexToRgb(awayTeam.color)
            console.log(`resetting away team color from alt ${JSON.stringify(hexToRgb(awayTeam.alternateColor))} from alt: ${JSON.stringify(awayTeamColor)} bc of similarity`)
        }
    }

    // if either color is too similar to white, use gray
    let colors = [homeTeamColor, awayTeamColor]
    var adjusted = false;
    colors.forEach((clr, idx) => {
        var dEBackground = deltaE([clr.r, clr.g, clr.b], [255,255,255])
        if (dEBackground <= 49) {
            adjusted = true;
            if (idx == 0) {
                homeTeamColor = hexToRgb("#CCCCCC")
            } else {
                awayTeamColor = hexToRgb("#CCCCCC")
            }
            console.log(`updating color at index ${idx} to gray bc of background`)
        }
    })

    // if both colors are now gray, reset the homeTeamColor
    let dEHomeAdj = deltaE([awayTeamColor.r, awayTeamColor.g, awayTeamColor.b], [homeTeamColor.r, homeTeamColor.g, homeTeamColor.b])
    if (dEHomeAdj <= 49 && adjusted) {
        homeTeamColor = hexToRgb(homeTeam.color);
        console.log(`resetting home color to ${JSON.stringify(homeTeamColor)} because of similarity to gray away color`)
    }

    return [awayTeamColor, homeTeamColor];
}

Chart.defaults.global.defaultFontColor = (isDarkMode) ? '#e8e6e3' : '#525252';

function generatePercentile(input, max = 134) {
    if (!input) {
        return 0;
    }
    let value = (parseFloat(max) - parseFloat(input)) / parseFloat(max)
    let step = Math.round(value * 100)
    return step
}

function retrieveValue(dictionary, key) {
    const subKeys = key.split('.')
    let sub = dictionary;
    for (const k of subKeys) {
        // if (!sub) {
        //     console.log(k)
        // }
        if (sub) {
            sub = sub[k];
        }
    }
    return sub;
}

function generateRadarPercentiles(breakdown, titleKey) {
    const key = titleKey.toLocaleLowerCase()
    return [
        { title: 'EPA/Play', key: "overall.epaPerPlay", percentile: generatePercentile(breakdown[key]?.overall.epaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "overall.epaPerPlay"), 2, 2) }, 
        { title: 'Early Downs EPA/Play', key: "overall.earlyDownEPAPerPlay", percentile: generatePercentile(breakdown[key]?.overall.earlyDownEPAPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "overall.earlyDownEPAPerPlay"), 2, 2) }, 
        { title: 'Late Downs SR%', key: "overall.lateDownSuccessRate", percentile: generatePercentile(breakdown[key]?.overall.lateDownSuccessRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "overall.lateDownSuccessRate") * 100, 2, 1)}%` }, 
        { title: 'Avg Distance (3rd)', key: "overall.thirdDownDistance", percentile: generatePercentile(breakdown[key]?.overall.thirdDownDistanceRank, 134), value: roundNumber(retrieveValue(breakdown[key], "overall.thirdDownDistance"), 2, 2) }, 
        { title: 'Rush EPA/Play', key: "rushing.epaPerPlay", percentile: generatePercentile(breakdown[key]?.rushing.epaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "rushing.epaPerPlay"), 2, 2) }, 
        { title: 'Stuff %', key: "rushing.stuffedPlayRate", percentile: generatePercentile(breakdown[key]?.rushing.stuffedPlayRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "rushing.stuffedPlayRate") * 100, 2, 1)}%` },
        { title: 'Line Yards', key: "rushing.lineYards", percentile: generatePercentile(breakdown[key]?.rushing.lineYardsRank, 134), value: roundNumber(retrieveValue(breakdown[key], "rushing.lineYards"), 2, 2) },
        { title: 'Opportunity %', key: "rushing.opportunityRate", percentile: generatePercentile(breakdown[key]?.rushing.opportunityRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "rushing.opportunityRate") * 100, 2, 1)}%` }, 
        { title: 'Explosive %', key: "overall.explosiveRate", percentile: generatePercentile(breakdown[key]?.overall.explosiveRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "overall.explosiveRate") * 100, 2, 1)}%` }, 
        { title: 'Pass Expl %', key: "passing.explosiveRate", percentile: generatePercentile(breakdown[key]?.passing.explosiveRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "passing.explosiveRate") * 100, 2, 1)}%` }, 
        { title: 'Rush Expl %', key: "rushing.explosiveRate", percentile: generatePercentile(breakdown[key]?.rushing.explosiveRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "rushing.explosiveRate") * 100, 2, 1)}%` }, 
        { title: 'Non-Expl EPA/Play', key: "overall.nonExplosiveEpaPerPlay", percentile: generatePercentile(breakdown[key]?.overall.nonExplosiveEpaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "overall.nonExplosiveEpaPerPlay"), 2, 2) },
        { title: 'Pass EPA/Play', key: "passing.epaPerPlay", percentile: generatePercentile(breakdown[key]?.passing.epaPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "passing.epaPerPlay"), 2, 2) }, 
        { title: 'Yds/DB', key: "passing.yardsPerPlay", percentile: generatePercentile(breakdown[key]?.passing.yardsPerPlayRank, 134), value: roundNumber(retrieveValue(breakdown[key], "passing.yardsPerPlay"), 2, 2) }, 
        { title: 'Pass SR%', key: "passing.successRate", percentile: generatePercentile(breakdown[key]?.passing.successRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "passing.successRate") * 100, 2, 1)}%` }, 
        { title: 'Havoc %', key: "overall.havocRate", percentile: generatePercentile(breakdown[key]?.overall.havocRateRank, 134), value: `${roundNumber(retrieveValue(breakdown[key], "overall.havocRate") * 100, 2, 1)}%` }, 
    ]
}

function generateDataset(breakdowns, titleKey, opponentKey) {
    const sample = generateRadarPercentiles({}, titleKey);
    

    const teamColors = breakdowns.map(b => {
        return { alternateColor: b.alternateColor, color: b.color }
    })
    const adjTeamColors = (teamColors.length > 1) ? adjustTeamColors(teamColors[0], teamColors[1]) : [adjustColor(hexToRgb(teamColors[0].color), hexToRgb(teamColors[0].alternateColor))]

    return {
        labels: sample.map(p => p.title),
        datasets: breakdowns.map((b, i) => {
            const teamPercentilesDataset = generateRadarPercentiles(b, (i % 2) == 0 ? titleKey : opponentKey)
            const teamColor = adjTeamColors[i];
            return {
                label: teamPercentilesDataset.map(p => `${b.teamName} - Raw: ${p.value}`),
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

function getNumberWithOrdinal(n) {
    let s = ["th", "st", "nd", "rd"];
    let v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function roundNumber(value, power10, fixed) {
    return (Math.round(parseFloat(value || 0) * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
}

function generateConfig(data, title) {
    return {
        type: 'radar',
        data: data,
        fill: true,
        plugins: [
            {
                afterDraw: (chart) => {
                    let viewport = getCurrentViewport()
                    if (viewport == "xl" || viewport == "lg") {
                        let sizeWidth = chart.ctx.canvas.clientWidth;
                        let sizeHeight = chart.ctx.canvas.clientHeight;
                        let imgSize = 25.0;
            
                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "8px Helvetica";
                        chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText("Metrics shown as percentiles. From GameOnPaper.com, by Akshay Easwaran (@akeaswaran)\nand Saiem Gilani (@saiemgilani)", sizeWidth - (imgSize / 4.0), 7.75 * (sizeHeight / 8))
                        chart.ctx.restore();
                    }
                }
            }
        ],
        options: {
            title: {
                display: true,
                text: title,
                fontColor: (isDarkMode) ? "white" : "black",
                fontSize: 15,
                fontFamily: '"Chivo", "Fira Mono", serif'
            },
            legend: false,
            responsive: true,
            elements: {
                line: {
                    borderWidth: 3
                }
            },
            tooltips: {
                callbacks: {
                    title: function(tooltipItem, data) {
                        // console.log(tooltipItem)
                        // console.log(data.labels)
                        const label = data.labels[tooltipItem[0].index]
                        return `${label}: ${getNumberWithOrdinal(tooltipItem[0].value)} %tile`
                    },
                    label: function(tooltipItem, data) {
                        return data.datasets[tooltipItem.datasetIndex].label[tooltipItem.index]
                    }
                }
            },
            scale: {
                angleLines: {
                    color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                },
                gridLines: {
                    color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                },
                ticks: {
                    min: 0,
                    max: 100,
                    suggestedMin: 0,
                    suggestedMax: 100,
                    stepSize: 25,
                    backdropColor: (isDarkMode) ? 'rgb(56, 61, 63)' : 'rgba(255, 255, 255, 0.75)'
                }
            }
        },
    }
}