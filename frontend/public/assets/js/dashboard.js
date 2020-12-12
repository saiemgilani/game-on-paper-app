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

var traversedQuarters = []
var timestamps = gameData.plays.map(p => calculateGameSecondsRemaining(p.period, calculateHalfSecondsRemaining(p.period, p.clock.displayValue)));
// console.log(timestamps)
var homeComp = gameData.gameInfo.competitors[0];
var awayComp = gameData.gameInfo.competitors[1];
var homeTeam = homeComp.team;
var awayTeam = awayComp.team;
var awayTeamColor = hexToRgb(awayTeam.alternateColor)
var homeTeamColor = hexToRgb(homeTeam.color)

var homeTeamWP = gameData.plays.map(p => ((p.start.team.id == homeTeam.id) ? translateWP(p.winProbability.before) : translateWP(1.0 - p.winProbability.before)));
var awayTeamWP = gameData.plays.map(p => ((p.start.team.id == awayTeam.id) ? translateWP(p.winProbability.before) : translateWP(1.0 - p.winProbability.before)));

var homeTeamEPA = calculateCumulativeSums(gameData.plays.filter(p => (p.start.team.id == homeTeam.id)).map(p => p.expectedPoints.added));
var homePlays = [...Array(homeTeamEPA.length).keys()]
var awayTeamEPA = calculateCumulativeSums(gameData.plays.filter(p => (p.start.team.id == awayTeam.id)).map(p => p.expectedPoints.added));
var awayPlays = [...Array(awayTeamEPA.length).keys()]

var finalPlays = homePlays;
if (homePlays.length > awayPlays.length) {
    finalPlays = homePlays;
} else {
    finalPlays = awayPlays;
}

// handle end of game
if (gameData.gameInfo.status.type.completed == true) {
    if (homeComp.winner == true || parseInt(homeComp.score) > parseInt(awayComp.score)) {
        timestamps.push(0)
        homeTeamWP.push(translateWP(1.0))
        awayTeamWP.push(translateWP(0.0))
      } else if (awayComp.winner == true || parseInt(homeComp.score) < parseInt(awayComp.score)) {
        timestamps.push(0)
        homeTeamWP.push(translateWP(0.0))
        awayTeamWP.push(translateWP(1.0))
      }
}

(function () {
  'use strict'

  feather.replace()

  // Graphs
  var ctx = document.getElementById('wpChart')
  // eslint-disable-next-line no-unused-vars
  var wpChart = new Chart(ctx, {
      type: 'line',
      data: {
          labels: timestamps,
          datasets: [
              {
                  data: homeTeamWP,
                  lineTension: 0,
                  label: homeTeam.abbreviation,
                  backgroundColor: `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`,
                  borderColor: homeTeam.color,
                  borderWidth: 4,
                  pointBackgroundColor: homeTeam.color
              },
              {
                  data: awayTeamWP,
                  lineTension: 0,
                  label: awayTeam.abbreviation,
                  backgroundColor: `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`,
                  borderColor: awayTeam.alternateColor,
                  borderWidth: 4,
                  pointBackgroundColor: awayTeam.alternateColor
              }
          ]
      },
      options: {
          legend: {
              display: true
          },
          tooltips: {
              callbacks: {
                  title: function(tooltipItem, data) {
                      console.log(tooltipItem)
                      var timeElapsed = Math.max(0, Math.min(3600, 3600 - parseInt(tooltipItem[0].label)));
                      return `Time Elapsed: ${timeElapsed}`
                  },
                  label: function(tooltipItem, data) {
                      var label = data.datasets[tooltipItem.datasetIndex].label || '';

                      if (label) {
                          label += ': ';
                      }
                      label += (Math.round(baseTranslate(tooltipItem.value, -1.0, 1.0, 0.0, 100.0) * 100) / 100)
                      label += "%"
                      return label;
                  }
              }
          },
          scales: {
                yAxes: [{
                    ticks: {
                        // Include a dollar sign in the ticks
                        callback: function(value, index, values) {
                            return (Math.round(baseTranslate(value, -1.0, 1.0, 0.0, 100.0) * 100) / 100) + '%'
                        }
                    },
                    scaleLabel: {
                        display: true,
                        labelString: "Win Probablity"
                    }
                }],
                xAxes: [{
                    ticks: {
                        // Include a dollar sign in the ticks
                        callback: function(value, index, values) {
                            return Math.max(0, Math.min(3600, 3600 - value))
                        }
                    },
                    scaleLabel: {
                        display: true,
                        labelString: "Game Seconds Elapsed (May look weird due to discrepancies in ESPN data)"
                    }
                }]
              }
      }
  })

  var epCtx = document.getElementById('epChart')
  // eslint-disable-next-line no-unused-vars
  var epChart = new Chart(epCtx, {
      type: 'line',
      data: {
          labels: finalPlays,
          datasets: [
              {
                  data: homeTeamEPA,
                  lineTension: 0,
                  label: homeTeam.abbreviation,
                  backgroundColor: `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.0)`,
                  borderColor: homeTeam.color,
                  borderWidth: 4,
                  pointBackgroundColor: homeTeam.color
              },
              {
                  data: awayTeamEPA,
                  lineTension: 0,
                  label: awayTeam.abbreviation,
                  backgroundColor: `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.0)`,
                  borderColor: awayTeam.alternateColor,
                  borderWidth: 4,
                  pointBackgroundColor: awayTeam.alternateColor
              }
          ]
      },
      options: {
          legend: {
              display: true
          },
          tooltips: {
              callbacks: {
                  title: function(tooltipItem, data) {
                      console.log(tooltipItem)
                      var timeElapsed = Math.max(0, Math.min(3600, 3600 - parseInt(tooltipItem[0].label)));
                      return `Play Number: ${timeElapsed}`
                  },
                  label: function(tooltipItem, data) {
                      var label = data.datasets[tooltipItem.datasetIndex].label || '';

                      if (label) {
                          label += ': ';
                      }
                      label += (parseFloat(tooltipItem.value) > 0 ? ("+" + tooltipItem.value) : tooltipItem.value)
                      return label;
                  }
              }
          },
          scales: {
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: "Total Offensive EPA"
                    }
                }],
                xAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: "Play Number"
                    }
                }]
            }
      }
  })

})()