function calculateHalfSecondsRemaining(period, time) {
  if (period == null) {
      return 0
  }

  if (time == null) {
      return 0
  }

  if (period > 4) {
      return 0
  }

  var splitTime = time.split(":")
  var minutes = (splitTime.length > 0) ? parseInt(splitTime[0]) : 0
  var seconds = (splitTime.length > 1) ? parseInt(splitTime[1]) : 0
  var adjMin = (period == 1 || period == 3) ? (15.0 + minutes) : minutes
  return Math.max(0, Math.min(1800, (adjMin * 60.0) + seconds))
  
}
function calculateGameSecondsRemaining(period, halfSeconds) {
  if (period <= 2) {
      return Math.max(0, Math.min(3600, 1800.0 + halfSeconds))
  } else {
      return halfSeconds
  }
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
  } : null;
}

function baseTranslate(input, inMin, inMax, outMin, outMax) {

  var leftRange = inMax - inMin;
  var rightRange = outMax - outMin;
  var scaledValue = (input - inMin) / leftRange;
  return outMin + (scaledValue * rightRange);
}

function translateWP(input) {
  return baseTranslate(input, 0.0, 1.0, -1.0, 1.0)
}

function calculateCumulativeSums(arr) {
    const cumulativeSum = (sum => value => sum += value)(0);
    return arr.map(cumulativeSum);
}

// https://www.trysmudford.com/blog/linear-interpolation-functions/
const lerp = (x, y, a) => x * (1 - a) + y * a;

// https://stackoverflow.com/questions/45394053/how-to-detect-screen-size-or-view-port-on-bootstrap-4-with-javascript
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

function interpolateTimestamps(plays) {
    if (plays.length == 0) {
        return plays;
    }
    plays.forEach(p => p.time_remaining = calculateHalfSecondsRemaining(p.period, p.clock.displayValue))
    var ind = [];
    for (var i = 0; i < plays.length; i+= 1) {
        // var play = plays[i]
        var nextPlay = null
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }

        if (nextPlay != null) {
            if (plays[i].time_remaining == nextPlay.time_remaining) {
                plays[i].time_remaining = null
            } else {
                plays[i].time_remaining = plays[i].time_remaining
            }
        }

        if (plays[i].time_remaining == 1800 && plays[i].period == 3) {
            ind.push(i)
        }
    }

    plays[0].time_remaining = 1800
    plays[plays.length - 1].time_remaining = 0
    
    // game is probably in progress?
    if (ind.length == 0) {
        ind.push(plays.length - 1)
    }

    ind.forEach(j => {
        let adjIndex = j - 1
        if (adjIndex >= 0 && adjIndex < plays.length) {
            plays[adjIndex].time_remaining = 0
        }
    })
    // console.log(ind)

    let halfPoint = ind[ind.length - 1]
    for (var i = 0; i < halfPoint; i++) {
        var pct = (i / halfPoint)
        // console.log("pct: " + pct)
        plays[i].time_remaining = Math.round(lerp(1800, 0, pct))
    }
    
    for (var i = halfPoint + 1; i < plays.length; i++) {
        var pct = ((i - (halfPoint + 1)) / (plays.length - (halfPoint + 1)))
        // console.log("pct: " + pct)
        plays[i].time_remaining = Math.round(lerp(1800, 0, pct))
    }
    
    plays.forEach(p => p.game_time_remaining = calculateGameSecondsRemaining(p.period, p.time_remaining))

    return plays;
}

// https://stackoverflow.com/a/52453462
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

if (gameData.plays.length > 0) {
    gameData.plays = interpolateTimestamps(gameData.plays)
    // console.log(gameData.plays[0])
    var timestamps = (gameData.gameInfo.status.type.completed == true) ? gameData.plays.map(p => p.game_time_remaining) : [...Array(gameData.plays.length).keys()];
    // console.log(timestamps)
    var homeComp = gameData.gameInfo.competitors[0];
    var awayComp = gameData.gameInfo.competitors[1];
    var homeTeam = homeComp.team;
    var awayTeam = awayComp.team;
    var awayTeamColor = hexToRgb(awayTeam.color)
    var homeTeamColor = hexToRgb(homeTeam.color)

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

    var homeTeamWP = gameData.plays.map(p => (p.pos_team == homeTeam.id) ? translateWP(p.winProbability.before) : translateWP(1.0 - p.winProbability.before));

    var homeTeamEPA = calculateCumulativeSums(gameData.plays.filter(p => (p.pos_team == homeTeam.id)).map(p => p.expectedPoints.added)).map((p, idx) => { return { "x": (idx + 1), "y": p } });
    var awayTeamEPA = calculateCumulativeSums(gameData.plays.filter(p => (p.pos_team == awayTeam.id)).map(p => p.expectedPoints.added)).map((p, idx) => { return { "x": (idx + 1), "y": p } });

    homeTeamEPA.splice(0, 0, {
        x: 0,
        y: 0
    });

    awayTeamEPA.splice(0, 0, {
        x: 0,
        y: 0
    });
    // handle end of game
    if (gameData.gameInfo.status.type.completed == true) {
        if (homeComp.winner == true || parseInt(homeComp.score) > parseInt(awayComp.score)) {
            timestamps.push(0)
            homeTeamWP.push(translateWP(1.0))
        } else if (awayComp.winner == true || parseInt(homeComp.score) < parseInt(awayComp.score)) {
            timestamps.push(0)
            homeTeamWP.push(translateWP(0.0))
        }
    }

    var targetDataSet = {
        yAxisID : 'y-axis-0',
        fill: true,
        lineTension: 0,
        pointRadius: 0,
        borderWidth: 3,
        label: null,
        data: homeTeamWP
    };


    Chart.plugins.register([
        {
            afterDraw: (chart) => {
                let viewport = getCurrentViewport()
                if (viewport == "xl" || viewport == "lg") {
                    let sizeWidth = chart.ctx.canvas.clientWidth;
                    let sizeHeight = chart.ctx.canvas.clientHeight;
                    let imgSize = 75.0;
        
                    chart.ctx.save()
                    chart.ctx.textAlign = "right"
                    chart.ctx.font = "8px Helvetica";
                    chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                    chart.ctx.fillText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran)\nand Saiem Gilani (@saiemgilani)", sizeWidth - (imgSize / 4.0), 7.25 * (sizeHeight / 8) - 35)
                    chart.ctx.restore();
                }
            }
        }
    ]);

    //adding custom chart type
    // https://stackoverflow.com/questions/36916867/chart-js-line-different-fill-color-for-negative-point
    // https://stackoverflow.com/questions/52120036/chartjs-line-color-between-two-points
    // https://stackoverflow.com/questions/63107181/drawing-images-on-top-of-graph-doesnt-work-with-chartjs
    // https://stackoverflow.com/questions/2359537/how-to-change-the-opacity-alpha-transparency-of-an-element-in-a-canvas-elemen/8001254
    Chart.defaults.NegativeTransparentLine = Chart.helpers.clone(Chart.defaults.line);
    Chart.controllers.NegativeTransparentLine = Chart.controllers.line.extend({
        update: function () {
            for(let i = 0; i < this.chart.data.datasets.length; i++) {
                // get the min and max values
                var min = Math.min.apply(null, this.chart.data.datasets[i].data);
                var max = Math.max.apply(null, this.chart.data.datasets[i].data);
                var yScale = this.getScaleForId(this.chart.data.datasets[i].yAxisID);
    
                // figure out the pixels for these and the value 0
                var top = yScale.getPixelForValue(max);
                var zero = yScale.getPixelForValue(0);
                var bottom = yScale.getPixelForValue(min);
    
                // build a gradient that switches color at the 0 point
                var ctx = this.chart.chart.ctx;
                ctx.save()
                var gradientFill = ctx.createLinearGradient(0, top, 0, bottom);
                var gradientStroke = ctx.createLinearGradient(0, top, 0, bottom);
                var ratio = Math.min((zero - top) / (bottom - top), 1);
                if (ratio < 0) {
                    ratio = 0;
                    gradientFill.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`);

                    gradientStroke.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`);
                } else if (ratio == 1) {
                    gradientFill.addColorStop(1, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`);

                    gradientStroke.addColorStop(1, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`);
                } else {
                    gradientFill.addColorStop(0, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`);
                    gradientFill.addColorStop(ratio, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`);
                    gradientFill.addColorStop(ratio, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`);
                    gradientFill.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`);

                    gradientStroke.addColorStop(0, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`);
                    gradientStroke.addColorStop(ratio, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`);
                    gradientStroke.addColorStop(ratio, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`);
                    gradientStroke.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`);
                }

                this.chart.data.datasets[i].backgroundColor = gradientFill;
                this.chart.data.datasets[i].borderColor = gradientStroke;
                this.chart.data.datasets[i].pointBorderColor = gradientStroke;
                this.chart.data.datasets[i].pointBackgroundColor = gradientStroke;
                this.chart.data.datasets[i].pointHoverBorderColor = gradientStroke;
                this.chart.data.datasets[i].pointHoverBackgroundColor = gradientStroke;
                ctx.restore();
            }
            return Chart.controllers.line.prototype.update.apply(this, arguments);
        },
        draw: function(ease) {
            // call the parent draw method (inheritance in javascript, whatcha gonna do?)
            let viewport = getCurrentViewport()
            if (viewport == "xl" || viewport == "lg") {
                var imgSize = 75.0;

                var ctx = this.chart.ctx;                                         // get the context
                ctx.save();
                ctx.globalAlpha = 0.4;
                var sizeWidth = ctx.canvas.clientWidth;
                var sizeHeight = ctx.canvas.clientHeight;

                if (this.homeTeamImage) {                                       // if the image is loaded
                    ctx.drawImage(this.homeTeamImage, (sizeWidth / 8), (sizeHeight / 8) - (imgSize / 4.0), imgSize, imgSize);             // draw it - ~145 px per half
                }

                if (this.awayTeamImage) {                                    // if the image is loaded
                    ctx.drawImage(this.awayTeamImage, (sizeWidth / 8), 5 * (sizeHeight / 8) - (imgSize / 2.0), imgSize, imgSize);             // draw it - ~145 px per half
                }
                ctx.restore();

                Chart.controllers.line.prototype.draw.call(this, ease);
            }
        },
        initialize: function(chart, datasetIndex) {                     // override initialize too to preload the image, the image doesn't need to be outside as it is only used by this chart
            Chart.controllers.line.prototype.initialize.call(this, chart, datasetIndex);
            var homeImage = new Image();
            homeImage.setAttribute('crossOrigin','anonymous');
            homeImage.src = `https://a.espncdn.com/i/teamlogos/ncaa/500/${homeTeam.id}.png`;
            homeImage.onload = () => {                                            // when the image loads
                this.homeTeamImage = homeImage;                                    // save it as a property so it can be accessed from the draw method
                chart.render();                                                 // and force re-render to include it
            };

            var awayImage = new Image();
            awayImage.setAttribute('crossOrigin','anonymous');
            awayImage.src = `https://a.espncdn.com/i/teamlogos/ncaa/500/${awayTeam.id}.png`;
            awayImage.onload = () => {                                            // when the image loads
                this.awayTeamImage = awayImage;                                    // save it as a property so it can be accessed from the draw method
                chart.render();                                                 // and force re-render to include it
            };
        }
    });

    (function () {
        'use strict'

        let isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
        let gridLines = {
            color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
            zeroLineColor: (isDarkMode) ? "white" : "#ACACAC"
        }
        Chart.defaults.global.defaultFontColor = (isDarkMode) ? '#e8e6e3' : '#525252';
        
        feather.replace()
        
        // Graphs
        var ctx = document.getElementById('wpChart')
        // eslint-disable-next-line no-unused-vars
        var wpChart = new Chart(ctx, {
            type: 'NegativeTransparentLine',
            data: {
                labels: timestamps,
                datasets: [
                    targetDataSet
                ]
            },
            options: {
                responsive: true,
                legend: false,
                scales: {
                    yAxes: [{
                        ticks: {
                            suggestedMax: 1.0,
                            suggestedMin: -1.0,
                            stepSize: 0.5,
                            callback: function(value, index, values) {
                                if (value > 0) {
                                    let transVal = baseTranslate(value, 0.0, 1.0, 50, 100); 
                                    return `${homeTeam.abbreviation} ${(Math.round(Math.abs(transVal) * 100) / 100)}%`
                                } else if (value < 0) {
                                    let transVal = baseTranslate(value, -1.0, 0.0, 100, 50); 
                                    return `${awayTeam.abbreviation} ${(Math.round(Math.abs(transVal) * 100) / 100)}%`
                                } else {
                                    return "50%";
                                }
                            }
                        },
                        scaleLabel: {
                            display: false,
                            labelString: "Win Probablity"
                        },
                        gridLines: gridLines
                    }],
                    xAxes: [{
                        ticks: {
                            // Include a dollar sign in the ticks
                            callback: function(value, index, values) {
                                if (gameData.gameInfo.status.type.completed == true) {
                                    return Math.max(0, Math.min(3600, 3600 - value))
                                } else {
                                    return value
                                }
                            }
                        },
                        scaleLabel: {
                            display: true,
                            labelString: (gameData.gameInfo.status.type.completed == true) ? "Game Seconds Elapsed (May look weird due to discrepancies in ESPN data)" : "Play Number"
                        },
                        gridLines: gridLines
                    }]
                },
                tooltips: {
                    callbacks: {
                        title: function(tooltipItem, data) {
                            if (gameData.gameInfo.status.type.completed == true) {
                                return `Game Seconds Elapsed: ${Math.max(0, Math.min(3600, 3600 - tooltipItem[0].label))}`
                            } else {
                                return `Total Play Number: ${tooltipItem[0].label}`
                            }
                        },
                        label: function(tooltipItem, data) {
                            // value is always from perspective of home team
                            if (tooltipItem.value > 0) {
                                let transVal = baseTranslate(tooltipItem.value, 0.0, 1.0, 50, 100); 
                                return `${homeTeam.abbreviation} WP: ${(Math.round(Math.abs(transVal) * 10) / 10)}%`
                            } else if (tooltipItem.value < 0) {
                                let transVal = baseTranslate(tooltipItem.value, -1.0, 0.0, 100, 50); 
                                return `${awayTeam.abbreviation} WP: ${(Math.round(Math.abs(transVal) * 10) / 10)}%`;
                            } else {
                                return "50%";
                            }
                        }
                    }
                }
            }
        })

        document.getElementById("wp-download").addEventListener('click', function() {
            /*Get image of canvas element*/
            var url_base64jp = wpChart.toBase64Image();
            /*get download button (tag: <a></a>) */
            var a =  document.getElementById("wp-download");
            /*insert chart image url to download button (tag: <a></a>) */
            a.href = url_base64jp;
        });

        var epCtx = document.getElementById('epChart')
            // eslint-disable-next-line no-unused-vars
        var epChart = new Chart(epCtx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        data: homeTeamEPA,
                        showLine: true,
                        fill: false,
                        lineTension: 0,
                        label: homeTeam.abbreviation,
                        backgroundColor: [`rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`],
                        borderColor: [`rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`],
                        borderWidth: 3,
                        pointHoverBackgroundColor: `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`,
                        pointHoverBorderColor: `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`,
                        pointBorderColor: `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`,
                        pointBackgroundColor: `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`,
                        pointRadius: 1.5
                    },
                    {
                        data: awayTeamEPA,
                        showLine: true,
                        fill: false,
                        lineTension: 0,
                        label: awayTeam.abbreviation,
                        backgroundColor: [`rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`],
                        borderColor: [`rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`],
                        borderWidth: 3,
                        pointHoverBackgroundColor: `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`,
                        pointHoverBorderColor: `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`,
                        pointBorderColor: `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`,
                        pointBackgroundColor: `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`,
                        pointRadius: 1.5
                    }
                ]
            },
            options: {
                showLine: true,
                responsive: true,
                legend: {
                    display: true
                },
                tooltips: {
                    callbacks: {
                        title: function(tooltipItem, data) {
                            //   console.log(tooltipItem)
                            //   var timeElapsed = Math.max(0, Math.min(3600, 3600 - parseInt(tooltipItem[0].label)));
                            return `Off Play Number: ${tooltipItem[0].label}`
                        },
                        label: function(tooltipItem, data) {
                            var label = data.datasets[tooltipItem.datasetIndex].label || '';

                            if (label) {
                                label += ': ';
                            }
                            var roundValue = (Math.round(tooltipItem.value * 100) / 100)
                            label += (parseFloat(tooltipItem.value) > 0 ? ("+" + roundValue) : roundValue)
                            return label;
                        }
                    }
                },
                scales: {
                        yAxes: [{
                            scaleLabel: {
                                display: true,
                                labelString: "Total EPA"
                            },
                            gridLines: gridLines
                        }],
                        xAxes: [{
                            scaleLabel: {
                                display: true,
                                labelString: "Off Play Number"
                            },
                            gridLines: gridLines
                        }]
                }
            }
        })

        document.getElementById("ep-download").addEventListener('click', function() {
            /*Get image of canvas element*/
            var url_base64jp = epChart.toBase64Image();
            /*get download button (tag: <a></a>) */
            var a =  document.getElementById("ep-download");
            /*insert chart image url to download button (tag: <a></a>) */
            a.href = url_base64jp;
        });
    })()    
}