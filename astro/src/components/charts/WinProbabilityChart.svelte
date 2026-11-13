<script>
import Chart from 'chart.js/auto';
import { leagueFromLocation, retryLightLogoOnce, teamLogoUrl } from '../../utils/league';
import {LineController} from "chart.js";
import { cleanAbbreviation, roundNumber, getNumberWithOrdinal, translateValue, getCurrentViewport, adjustTeamColorsForContrast, hexToRgb, waitForElement } from '../../utils/misc';
import { SPECIAL_IMAGES, SPECIAL_IMAGES_DARK } from '../../utils/constants'
import { GradientFillLineController, chartGridLines } from '../../resources/chart'
import { wpMarkerGate, wpMarkerTitle } from '../../basketball/periods';
import { exportTime, wpExportFooter } from '../../utils/chartExport'
import { momentText, stretchText } from '../../utils/wpLenses'

// lenses / moments: basketball's 'bball-wp-lenses' (BB-G45) only; absent, the chart is football's and today's basketball's
const { id, homeComp, awayComp, gameStatus, homeTeamSpread, overUnder, plays, percentiles, gei, showGei = false, spanShade = null, colors = null, showOdds = true, allPeriodMarkers = false, regulationPeriods = 4, periodKind = 'quarter', season = null, exportMeta = null, lenses = null, moments = null } = $props()
const homeTeam = homeComp.team;
const awayTeam = awayComp.team;

// BB-G45: the lens shown (our model first), and the pinned play / dragged stretch the readout describes (chart x indices)
let lens = $state(lenses?.[0]?.key ?? 'model');
let readout = $state('');
let pinned = null, stretch = null, dragFrom = null, dragTo = null;
const lensValues = (key) => (lenses?.find((l) => l.key === key) ?? lenses?.[0])?.values ?? [];
const momentAt = (i) => moments[Math.max(0, Math.min(i, moments.length - 1))];
const homeWpAt = (i) => { const v = lensValues(lens); return v.length ? v[Math.max(0, Math.min(i, v.length - 1))] : plays[Math.max(0, Math.min(i, plays.length - 1))].winProbability.before; };
function describe() {
    const h = cleanAbbreviation(homeTeam), a = cleanAbbreviation(awayTeam);
    if (stretch) readout = stretchText(momentAt(stretch[0]), momentAt(stretch[1]), homeWpAt(stretch[0]), homeWpAt(stretch[1]), h, a);
    else if (pinned != null) readout = `Pinned: ${momentText(momentAt(pinned), homeWpAt(pinned), h, a)}`;
    else readout = '';
}
function setLens(key) {
    lens = key;
    const chart = Chart.getChart("wpChart");
    if (!chart) return;
    const cur = chart.data.datasets[0].data;
    // the final's settled point (1 or 0) after the last play is the same on every lens
    chart.data.datasets[0].data = [...lensValues(key).map(translateWP), ...(cur.length > plays.length ? [cur[cur.length - 1]] : [])];
    chart.update();
    describe();
}
// the pinned play and the dragged stretch, drawn under the lines
const marksPlugin = (isDarkMode) => ({
    id: 'wp-marks',
    beforeDatasetsDraw: (chart) => {
        const xs = chart.scales.x;
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        const band = dragFrom != null && dragTo != null && dragFrom !== dragTo ? [Math.min(dragFrom, dragTo), Math.max(dragFrom, dragTo)] : stretch;
        if (band) {
            const x0 = xs.getPixelForValue(band[0]), x1 = xs.getPixelForValue(band[1]);
            ctx.fillStyle = isDarkMode ? 'rgba(255, 213, 79, 0.12)' : 'rgba(255, 193, 7, 0.18)';
            ctx.fillRect(x0, top, Math.max(2, x1 - x0), bottom - top);
        }
        if (pinned != null && !band) {
            const x = xs.getPixelForValue(pinned);
            ctx.strokeStyle = isDarkMode ? '#ffd54f' : '#b45309';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        }
        ctx.restore();
    },
});
// hover is the tooltip; a click pins a play, a drag reads a stretch (pointer events: mouse, pen and touch)
function wireMarks(chart) {
    const canvas = chart.canvas;
    const indexAt = (e) => {
        const r = canvas.getBoundingClientRect();
        const v = Math.round(chart.scales.x.getValueForPixel(e.clientX - r.left));
        return Math.max(0, Math.min(v, moments.length - 1));
    };
    canvas.style.touchAction = 'pan-y'; // a horizontal drag reads a stretch, a vertical one still scrolls the page
    canvas.onpointerdown = (e) => { dragFrom = dragTo = indexAt(e); };
    canvas.onpointermove = (e) => { if (dragFrom == null) return; dragTo = indexAt(e); chart.draw(); };
    canvas.onpointerup = (e) => {
        if (dragFrom == null) return;
        const to = indexAt(e);
        if (to === dragFrom) { pinned = pinned === to && !stretch ? null : to; stretch = null; } // a second click on the pin clears it
        else { stretch = [Math.min(dragFrom, to), Math.max(dragFrom, to)]; pinned = null; }
        dragFrom = dragTo = null;
        chart.draw();
        describe();
    };
    canvas.onpointerleave = () => { if (dragFrom != null) { dragFrom = dragTo = null; chart.draw(); } };
}

function createVerticalLinePlugin(id, title, value, color, lineWidth, xAxisId = 'x', yAxisId = 'y', yMin = null, yMax = null) {
    // console.log(
    //     [id, title, value, color, lineWidth, xAxisId, yAxisId, yMin, yMax]
    // )

    const callback = (chart) => {
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        
        var top = chart.chartArea.top;
        var bottom = chart.chartArea.bottom;
        if (yMin != null && yMax != null) {
            top = yScale.getPixelForValue(yMax);
            bottom = yScale.getPixelForValue(yMin);
        }

        const xValue = xScale.getPixelForValue(value);
        const ctx = chart.ctx;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(xValue, top);
        ctx.lineTo(xValue, bottom);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        ctx.restore();

        // only draw titles when there's space
        let viewport = getCurrentViewport(document, window)
        if (viewport == "xl" || viewport == "lg") {
            chart.ctx.save()
            chart.ctx.textAlign = "left"
            chart.ctx.font = "10px Helvetica";
            chart.ctx.fillStyle = color;
            chart.ctx.fillText(title, xValue + 5, top + 15)
            chart.ctx.restore();
        }
    }
    return {
        id: id,
        beforeDraw: callback
    };
}

// Translucent box over the active span (chart data stays full-game;
// a WP chart of one quarter alone is misleading). Same canvas-plugin pattern
// as createVerticalLinePlugin; indices are positions on the x axis.
function createSpanShadePlugin(shade, isDarkMode) {
    return {
        id: 'span-shade',
        beforeDatasetsDraw: (chart) => {
            const xScale = chart.scales.x;
            if (!xScale) return;
            const x0 = xScale.getPixelForValue(shade.from);
            // each play occupies [x(i), x(i+1)): an inclusive-to band ends at
            // the NEXT play's x, which for a whole quarter is exactly the next
            // period's marker (QA on #215 -- the edge was one play short).
            // The last play of the game has no next x; clamp to the axis end.
            const xEnd = Math.min(shade.to + 1, (chart.data.labels?.length ?? 1) - 1);
            // a one-play window at the axis end still keeps a visible box
            const x1 = Math.max(xScale.getPixelForValue(xEnd), x0 + 3);
            const { top, bottom } = chart.chartArea;
            const ctx = chart.ctx;
            ctx.save();
            ctx.fillStyle = isDarkMode ? 'rgba(255, 213, 79, 0.10)' : 'rgba(255, 193, 7, 0.14)';
            ctx.fillRect(x0, top, x1 - x0, bottom - top);
            ctx.textAlign = 'left';
            ctx.font = 'bold 10px Helvetica';
            ctx.fillStyle = isDarkMode ? '#ffd54f' : '#b45309';
            ctx.fillText(shade.label, x0 + 4, bottom - 6);
            ctx.restore();
        },
    };
}

function geiGenerateColorRampValue(input) {
    if (percentiles.length == 0) {
        //console.log('no pctls available')
        return {
            pctl: null,
            ramp_class: null,
            min: null,
            mid: null,
            max: null
        }
    }

    //console.log(`calc pctl for key ${adjKey} w/ val ${value}`)

    let basePctls = percentiles.map(item => {
        let val = item["GEI"];
        return parseFloat(val)
    })
    basePctls.sort((a, b) => {
        return parseFloat(a) - parseFloat(b)
    })

    if (basePctls[0] == null || basePctls.length == 0) {
        //console.log('all ptcls null for key ' + adjKey)
        return {
            pctl: null,
            ramp_class: null,
            min: null,
            mid: null,
            max: null
        }
    }
    
    let pctls = [...basePctls];
    //console.log(`mapped pctls for key ${adjKey}: ${JSON.stringify(pctls, null, 2)}`)
    pctls = pctls.filter(item => {
        return parseFloat(item) <= parseFloat(input)
    });

    // console.log(`pct calc for key ${key} is ${pct}`)
    let value = parseFloat(pctls.length) / 100
    let step = Math.round(value / 0.1)
    let clampedStep = Math.min(Math.max(step, 0), 9)

    if (clampedStep == 4 || clampedStep == 5) {
        return {
            pctl: pctls.length,
            ramp_class: null,
            min: roundNumber(basePctls[0], 2, 2),
            mid: roundNumber(basePctls[Math.floor(basePctls.length / 2)], 2, 2),
            max: roundNumber(basePctls[basePctls.length - 1], 2, 2),
        }
    } else {
        return {
            pctl: pctls.length,
            ramp_class: ` hulk-bg-level-${clampedStep}`,
            min: roundNumber(basePctls[0], 2, 2),
            mid: roundNumber(basePctls[Math.floor(basePctls.length / 2)], 2, 2),
            max: roundNumber(basePctls[basePctls.length - 1], 2, 2),
        }
    }
}

function translateWP(input) {
  return translateValue(input, 0.0, 1.0, -1.0, 1.0)
}

function printSpread() {
    if (parseFloat(homeTeamSpread) > 0) {
        return `${cleanAbbreviation(homeTeam)} -${homeTeamSpread}`
    } else if (parseFloat(homeTeamSpread) < 0) {
        return `${cleanAbbreviation(awayTeam)} ${homeTeamSpread}`
    } else {
        return "PUSH"
    }
}
const lastPlay = plays[plays.length - 1]
const gameInProgress = !(gameStatus.type.completed == true) && ((gameStatus.type.name.includes("STATUS_IN_PROGRESS") || gameStatus.type.name.includes("STATUS_END_PERIOD") || gameStatus.type.name.includes("STATUS_HALFTIME")) && plays.length > 0);

const geiVal = (Math.round((gei || 0) * 100) / 100) 
const geiPctl = geiGenerateColorRampValue(geiVal)
const geiTitle = `%ile: ${getNumberWithOrdinal(geiPctl.pctl)}\nMost Boring: ${geiPctl.min}\nMedian: ${geiPctl.mid}\nMost Exciting: ${geiPctl.max}`;

// The shareable image: title band, the chart on the page background, URL footer.
// Colours and font are the page's, read when the chart drew (see generateChart), so the
// band matches the chart's theme even if the system theme flipped since.
function composeExport(src, meta, page) {
    const dpr = window.devicePixelRatio || 1;
    const pad = 16 * dpr, titleH = 30 * dpr, footH = 24 * dpr;
    const out = document.createElement('canvas');
    out.width = src.width + 2 * pad;
    out.height = src.height + titleH + footH + 2 * pad;
    const ctx = out.getContext('2d');
    ctx.fillStyle = page.backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = page.color;
    // maxWidth: on a phone the title is wider than the chart, so the canvas narrows it to fit
    ctx.font = `bold ${16 * dpr}px ${page.fontFamily}`;
    ctx.fillText(meta.title, pad, pad + 18 * dpr, src.width);
    ctx.drawImage(src, pad, pad + titleH);
    ctx.font = `${11 * dpr}px ${page.fontFamily}`;
    ctx.fillText(wpExportFooter(meta, (iso) => exportTime(iso)), pad, out.height - pad, src.width);
    return out.toDataURL('image/png');
}

async function generateChart() {
    GradientFillLineController.id = 'GradientFillLineController';
    GradientFillLineController.defaults = LineController.defaults;

    // Stores the controller so that the chart initialization routine can look it up
    Chart.register(GradientFillLineController);

    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // copied, not the live object: the export must keep the theme this chart drew in
    const { backgroundColor, color, fontFamily } = getComputedStyle(document.body);
    const exportStyle = { backgroundColor, color, fontFamily };
    // the page's colour decision for this theme when it made one ('game-colours'), else the legacy per-chart rule
    const pair = colors && (isDarkMode ? colors.dark : colors.light)
    const [awayTeamColor, homeTeamColor] = pair ? [hexToRgb(pair.away), hexToRgb(pair.home)] : adjustTeamColorsForContrast(awayTeam, homeTeam)

    var timestamps = [...Array(plays.length).keys()];
    let periodMarkers = []
    let periodTracks = {}
    for (let i = 0; i < (plays.length - 1); i++) {
        const j = (i - 1);
        const prevPlay = plays[j];
        const curPlay = plays[i];

        if (!prevPlay || ((parseInt(prevPlay.period) < parseInt(curPlay.period)) && wpMarkerGate(parseInt(curPlay.period), allPeriodMarkers, regulationPeriods))) {
            const per = parseInt(curPlay.period)
            // allPeriodMarkers (basketball): every overtime gets its own marker, OT then 2OT, 3OT...; football keeps one OT marker
            const title = wpMarkerTitle(per, allPeriodMarkers, regulationPeriods, periodKind);

            if (Object.keys(periodTracks).includes(title)) {
                continue;
            }

            periodMarkers.push(
                createVerticalLinePlugin(
                    `period-${curPlay.period}`,
                    title,
                    i,
                    isDarkMode ? '#e8e6e3' : '#525252',
                    2.5,
                    'x-axis-0',
                    'y-axis-0',
                    -1,
                    1
                )
            )
            periodTracks[title] = i;
        }
    }

    var homeTeamWP = plays.map(p => (p.pos_team == homeTeam.id) ? translateWP(p.winProbability.before) : translateWP(1.0 - p.winProbability.before));

    // handle end of game
    if (gameStatus.type.completed == true) {
        if (homeComp.winner == true || parseInt(homeComp.score) > parseInt(awayComp.score)) {
            timestamps.push((timestamps[timestamps.length - 1] + 1))
            homeTeamWP.push(translateWP(1.0))
        } else if (awayComp.winner == true || parseInt(homeComp.score) < parseInt(awayComp.score)) {
            timestamps.push((timestamps[timestamps.length - 1] + 1))
            homeTeamWP.push(translateWP(0.0))
        }
    }
    // BB-G45: the lens shown replaces the plays' WP, keeping the final's settled point
    if (lenses) homeTeamWP = [...lensValues(lens).map(translateWP), ...homeTeamWP.slice(plays.length)];
    // BB-G45: the home margin per play (the settled point repeats the last), drawn under the WP line on its own axis
    const margins = moments ? timestamps.map((i) => { const m = momentAt(i); return m.h - m.a; }) : null;
    const marginTop = margins ? Math.max(5, Math.ceil(Math.max(...margins.map(Math.abs)) / 5) * 5) : 0;

    var targetDataSet = {
        fill: true,
        lineTension: 0,
        pointRadius: 0,
        borderWidth: 3,
        label: null,
        data: homeTeamWP,
        hoverBackgroundColor: JSON.stringify(awayTeamColor),
        hoverBorderColor: JSON.stringify(homeTeamColor),
        // with BB-G45's margin axis there are two y scales: pin the WP line to its own
        ...(margins ? { yAxisID: 'y' } : {}),
    };


    var wpChart = new Chart(document.getElementById("wpChart"), {
        type: 'GradientFillLineController',
        plugins: [
            ...(spanShade ? [createSpanShadePlugin(spanShade, isDarkMode)] : []),
            ...periodMarkers,
            ...(moments ? [marksPlugin(isDarkMode)] : []),
            {
                beforeDatasetDraw: (chart, args) => {
                    if (args && args.index !== 0) return; // once, before the WP line (BB-G45's margin line is dataset 1)
                    const viewport = getCurrentViewport(document, window);
                    const sizeWidth = chart.ctx.canvas.clientWidth;
                    const sizeHeight = chart.ctx.canvas.clientHeight;
                    const imgSize = 75.0;

                    if (viewport == "xl" || viewport == "lg") {
                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "8px Helvetica";
                        chart.ctx.fillStyle = (isDarkMode) ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText("From GameOnPaper.com, by Akshay Easwaran (@akeaswaran)\nand Saiem Gilani (@saiemgilani)", sizeWidth - (imgSize / 4.0), 7.5 * (sizeHeight / 8) - 45)
                        chart.ctx.restore();

                        // get the context
                        chart.ctx.save();
                        chart.ctx.globalAlpha = 0.4;

                        if (chart.homeTeamImage) {
                            chart.ctx.drawImage(chart.homeTeamImage, (sizeWidth / 8), (sizeHeight / 8) - (imgSize / 4.0), imgSize, imgSize);  
                        }

                        if (chart.awayTeamImage) {
                            chart.ctx.drawImage(chart.awayTeamImage, (sizeWidth / 8), 5 * (sizeHeight / 8) - (imgSize / 2.0), imgSize, imgSize);    
                        //     // draw it - ~145 px per half                                           // and force re-render to include it 
                        }

                        // pop the context
                        chart.ctx.restore();
                    }
                },
            },
            {
                afterInit: (chart) => {
                    const homeImage = new Image();
                    const homeId = `${homeTeam.id}`;
                    homeImage.setAttribute('crossOrigin','anonymous');
                    if (Object.keys(SPECIAL_IMAGES).includes(homeId)) {
                        homeImage.src = SPECIAL_IMAGES[homeId];
                    }
                    
                    if (isDarkMode && Object.keys(SPECIAL_IMAGES_DARK).includes(homeId)) {
                        homeImage.src = SPECIAL_IMAGES_DARK[homeId];
                    }

                    if (!homeImage.src) {
                        homeImage.src = teamLogoUrl(leagueFromLocation(), homeTeam.id, isDarkMode, season);
                    }

                    // a missing dark variant must not cost the chart its logo: retry the light one once
                    homeImage.onerror = () => retryLightLogoOnce(homeImage, teamLogoUrl(leagueFromLocation(), homeTeam.id, false, season), location.href);
                    homeImage.onload = () => {                                            // when the image loads
                        chart.homeTeamImage = homeImage;                                    // save it as a property so it can be accessed from the draw method
                        chart.render();                                                 // and force re-render to include it
                    };

                    var awayImage = new Image();
                    var awayId = `${awayTeam.id}`;
                    awayImage.setAttribute('crossOrigin','anonymous');
                    if (Object.keys(SPECIAL_IMAGES).includes(awayId)) {
                        awayImage.src = SPECIAL_IMAGES[awayId];
                    }

                    if (isDarkMode && Object.keys(SPECIAL_IMAGES_DARK).includes(awayId)) {
                        awayImage.src = SPECIAL_IMAGES_DARK[awayId];
                    }

                    if (!awayImage.src) {
                        awayImage.src = teamLogoUrl(leagueFromLocation(), awayTeam.id, isDarkMode, season);
                    }

                    // a missing dark variant must not cost the chart its logo: retry the light one once
                    awayImage.onerror = () => retryLightLogoOnce(awayImage, teamLogoUrl(leagueFromLocation(), awayTeam.id, false, season), location.href);
                    awayImage.onload = () => {                                            // when the image loads
                        chart.awayTeamImage = awayImage;                                    // save it as a property so it can be accessed from the draw method
                        chart.render();                                                 // and force re-render to include it
                    };
                }
            },
        ],
        data: {
            labels: timestamps,
            datasets: [
                targetDataSet,
                // order 1: drawn before (under) the WP line, which keeps order 0
                ...(margins ? [{ type: 'line', label: 'margin', yAxisID: 'y1', order: 1, data: margins, stepped: true, fill: false, pointRadius: 0, borderWidth: 1.5,
                    borderColor: isDarkMode ? 'rgba(232, 230, 227, 0.9)' : 'rgba(64, 64, 64, 0.9)' }] : []),
            ]
        },
        options: {
            responsive: true,
            // BB-G45: hovering anywhere over a play reads it (WP and margin together)
            ...(moments ? { interaction: { mode: 'index', intersect: false } } : {}),
            scales: {
                ...(margins ? { y1: {
                    position: 'right', min: -marginTop, max: marginTop, // symmetric, so a tie sits on the 50% line
                    grid: { display: false },
                    ticks: { color: (isDarkMode) ? '#e8e6e3' : '#525252', stepSize: marginTop <= 10 ? 5 : marginTop <= 30 ? 10 : 20,
                        callback: (v) => (v === 0 ? '0' : `${v > 0 ? cleanAbbreviation(homeTeam) : cleanAbbreviation(awayTeam)} +${Math.abs(v)}`) },
                } } : {}),
                y: {
                    border: { color: (isDarkMode) ? "#8D8D8D" : "#AAAAAA" },
                    suggestedMax: 1.0,
                    suggestedMin: -1.0,
                    ticks: {
                        stepSize: 0.5,
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252',
                        callback: function(value) {
                            if (value > 0) {
                                let transVal = translateValue(value, 0.0, 1.0, 50, 100);
                                return `${cleanAbbreviation(homeTeam)} ${(Math.round(Math.abs(transVal) * 100) / 100)}%`
                            } else if (value < 0) {
                                let transVal = translateValue(value, -1.0, 0.0, 100, 50);
                                return `${cleanAbbreviation(awayTeam)} ${(Math.round(Math.abs(transVal) * 100) / 100)}%`
                            } else {
                                return "50%";
                            }
                        }
                    },
                    title: {
                        display: false,
                        text: "Win Probability",
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252',
                        font: {
                            family: '"Chivo", "Fira Mono", serif'
                        },
                    },
                    grid: chartGridLines(getComputedStyle(document.body).color, isDarkMode),
                },
                x: {
                    border: { color: (isDarkMode) ? "#8D8D8D" : "#AAAAAA" },
                    ticks: {
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252'
                    },
                    title: {
                        display: true,
                        text: "Play Number",
                        color: (isDarkMode) ?  '#e8e6e3' : '#525252',
                        font: {
                            family: '"Chivo", "Fira Mono", serif'
                        },
                    },
                    grid: chartGridLines(getComputedStyle(document.body).color, isDarkMode),
                }
            },
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    callbacks: {
                        title: function(contexts) {
                            if (moments) return `Play ${contexts[0].dataIndex}: ${momentAt(contexts[0].dataIndex).at}`
                            return `Play Number: ${contexts[0].dataIndex}`
                        },
                        label: function(context) {
                            if (context.dataset.label === 'margin') {
                                const m = momentAt(context.dataIndex);
                                return `Score: ${cleanAbbreviation(awayTeam)} ${m.a}-${m.h} ${cleanAbbreviation(homeTeam)}`;
                            }
                            // value is always from perspective of home team
                            if (context.parsed.y > 0) {
                                let transVal = translateValue(context.parsed.y, 0.0, 1.0, 50, 100);
                                return `${cleanAbbreviation(homeTeam)} WP: ${(Math.round(Math.abs(transVal) * 10) / 10)}%`
                            } else if (context.parsed.y < 0) {
                                let transVal = translateValue(context.parsed.y, -1.0, 0.0, 100, 50);
                                return `${cleanAbbreviation(awayTeam)} WP: ${(Math.round(Math.abs(transVal) * 10) / 10)}%`;
                            } else {
                                return "50%";
                            }
                        }
                    }
                }
            },
        }
    })
    if (moments) wireMarks(wpChart);

    // a property, not a listener: a theme redraw must replace the handler bound to the old chart
    document.getElementById("wp-download").onclick = function() {
        var a =  document.getElementById("wp-download");
        a.href = exportMeta ? composeExport(wpChart.canvas, exportMeta, exportStyle) : wpChart.toBase64Image('image/png');
    };
}

async function waitToGenerateChart() {
    try {
        const context = await waitForElement(document, "wpChart")
        await generateChart()
    } catch (e) {
        console.error(e);
        const container = document.getElementById("wp_container");
        if (container) {
            container.innerHTML = `<p class='m-0 mb-3 text-muted text-small'>Unable to generate chart. Please reach out to <a href="https://bsky.app/profile/akeaswaran.me">@akeaswaran.me</a> or <a href="https://bsky.app/profile/saiemgilani.bsky.social">@saiemgilani</a> on Bluesky with the page and chart options you're trying to access.</p>`
        }
    }
}

// redraw when the theme flips: the per-theme colours, and the dark flag the ticks, borders and grid alpha read at
// generation, must follow the new theme with or without `colors` (CodeRabbit on #339)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    Chart.getChart("wpChart")?.destroy()
    waitToGenerateChart()
})

if (document.readyState !== 'loading') {
    console.log(`DOM ready state`)
    waitToGenerateChart()
} else {
    document.addEventListener('DOMContentLoaded', () => {
        console.log(`DOM content loaded state`)
        waitToGenerateChart()
    })
}

</script>

<div class="row">
    <div>
        {#if showOdds}
        <h2 class="mb-0">Win Probability</h2>
        <p class="m-0 text-muted text-small" hidden={lastPlay.gameSpreadAvailable}>ESPN does not list betting odds for this game, so we've used default values: {cleanAbbreviation(homeTeam)} -2.5, O/U 55.5.</p>
        {/if}
        <p class="text-small">
            {#if showOdds}
            {#if !gameInProgress}
            <a href="https://www.opensourcefootball.com/posts/2020-08-21-game-excitement-and-win-probability-in-the-nfl/" title="Measures 'game excitement' by absolute changes in win probability. May not match eye-test in games with heavy favorites.">Game Excitement Index:</a> <span class={`${geiPctl.ramp_class} px-1`} title={geiTitle}>{ geiVal.toFixed(2) }</span> | 
            {/if}
            Odds: {printSpread()}, O/U {roundNumber(parseFloat(overUnder), 2, 1)}
            {:else if showGei && !gameInProgress}
            <!-- basketball ('bball-gei'): the GEI alone; no season percentiles to ramp it against yet -->
            <a href="https://www.opensourcefootball.com/posts/2020-08-21-game-excitement-and-win-probability-in-the-nfl/" title="Measures 'game excitement' by absolute changes in win probability. May not match eye-test in games with heavy favorites.">Game Excitement Index:</a> <span class="px-1">{ roundNumber(geiVal, 2, 2) }</span>
            {/if}
            {#if gameInProgress}
                {#if (lastPlay.winProbability.before >= 0.5) }
                {showOdds ? '| ' : ''}Current: {(lastPlay.pos_team == homeTeam.id) ? cleanAbbreviation(homeTeam) : cleanAbbreviation(awayTeam)} {((Math.round(lastPlay.winProbability.before * 1000) / 1000) * 100).toFixed(1)}%
                {/if}
                {#if (lastPlay.winProbability.before < 0.5) }
                {showOdds ? '| ' : ''}Current: {(lastPlay.pos_team == homeTeam.id) ? cleanAbbreviation(awayTeam) : cleanAbbreviation(homeTeam)} {((Math.round((1.0 - lastPlay.winProbability.before) * 1000) / 1000) * 100).toFixed(1)}%
                {/if}
            {/if}
            {(showOdds || gameInProgress || showGei) ? '| ' : ''}<a id="wp-download" download={`game-wp-${id}.png`} href="#">Download Chart</a>
        </p>
        {#if lenses}
        <div class="btn-group btn-group-sm mb-2 flex-wrap" role="group" aria-label="Win probability lens">
            {#each lenses as l (l.key)}
            <input type="radio" class="btn-check" name={`wp-lens-${id}`} id={`wp-lens-${id}-${l.key}`} value={l.key} checked={lens === l.key} onchange={() => setLens(l.key)} />
            <label class="btn btn-outline-secondary" for={`wp-lens-${id}-${l.key}`}>{l.label}</label>
            {/each}
        </div>
        {/if}
    </div>
    <div class="w-100"  width="900" height="380" id="wp_container"><canvas id="wpChart"></canvas></div>
    {#if moments}
    <p class="text-small mb-0" id="wp-readout" aria-live="polite">{readout}</p>
    {/if}
</div>
