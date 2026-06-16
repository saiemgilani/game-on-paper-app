
<script>
import Chart from 'chart.js/auto';
import { cleanAbbreviation,  getCurrentViewport, adjustColorsForContrast, calculateCumulativeSums, roundNumber } from '../../utils/misc';
const { id, plays, homeTeam, awayTeam } = $props();

async function generateChart() {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let homeTeamEPA = calculateCumulativeSums(plays.filter(p => (p.pos_team == homeTeam.id && p.scrimmage_play == true)).map(p => p.expectedPoints.added)).map((p, idx) => { return { "x": (idx + 1), "y": p } });
    let awayTeamEPA = calculateCumulativeSums(plays.filter(p => (p.pos_team == awayTeam.id && p.scrimmage_play == true)).map(p => p.expectedPoints.added)).map((p, idx) => { return { "x": (idx + 1), "y": p } });

    homeTeamEPA.splice(0, 0, {
        x: 0,
        y: 0
    });

    awayTeamEPA.splice(0, 0, {
        x: 0,
        y: 0
    });

    const [awayTeamColor, homeTeamColor] = adjustColorsForContrast(awayTeam, homeTeam)

    const epChart = new Chart(document.getElementById("epChart"), {
        type: 'scatter',
        data: {
            datasets: [
                {
                    data: homeTeamEPA,
                    showLine: true,
                    fill: false,
                    lineTension: 0,
                    label: cleanAbbreviation(homeTeam),
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
                    label: cleanAbbreviation(awayTeam),
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
        plugins: [
            {
                afterDraw: (chart) => {
                    let viewport = getCurrentViewport(document, window)
                    if (viewport == "xl" || viewport == "lg") {
                        let sizeWidth = chart.ctx.canvas.clientWidth;
                        let sizeHeight = chart.ctx.canvas.clientHeight;
                        let imgSize = 75.0;

                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "8px Helvetica";
                        chart.ctx.fillStyle = (isDarkMode) ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran)\nand Saiem Gilani (@saiemgilani)", sizeWidth - (imgSize / 4.0), 7.5 * (sizeHeight / 8) - 35)
                        chart.ctx.restore();
                    }
                }
            }
        ],
        options: {
            showLine: true,
            responsive: true,
            legend: {
                display: true
            },
            font: {
                color: (isDarkMode) ?  '#e8e6e3' : '#525252'
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: function(contexts) {
                            return `Off Play Number: ${contexts[0].dataIndex}` 
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';

                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += roundNumber(context.parsed.y, 2, 2);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    title: {
                        display: true,
                        text: "Total Offensive EPA",
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    grid: {
                        color: (line) => {
                            if (line.tick.value == 0) {
                                return (isDarkMode) ? "white" : "#ACACAC"
                            }
                            return (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                        }, 
                        borderColor: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                    }
                },
                x: {
                    ticks: {
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    title: {
                        display: true,
                        text: "Scrimmage Play Number",
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    grid: {
                        color: (line) => {
                            if (line.tick.value == 0) {
                                return (isDarkMode) ? "white" : "#ACACAC"
                            }
                            return (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                        },
                        borderColor: (isDarkMode) ? "#8D8D8D" : "#E5E5E5",
                    }
                }
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
}


document.addEventListener('DOMContentLoaded', generateChart);

</script>

<div class="row">
    <div>
        <h2 class="mb-0">Expected Points</h2>
        <p class="text-small"><a id="ep-download" download={`game-ep-${id}.jpg`} href="#">Download Chart</a></p>
    </div>
    <div class="w-100"  width="900" height="380"><canvas id="epChart"></canvas></div>
</div>