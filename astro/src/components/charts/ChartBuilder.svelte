<script lang="ts">
    import Chart from 'chart.js/auto';
    import { type ChartConfiguration, type ChartItem } from 'chart.js';
    import { AVAILABLE_SEASONS, LAST_YEAR, SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS, SPECIAL_IMAGES } from '../../utils/constants';
    import { formatNumberForMetric, generateTeamMetricTitle, getAxisTitleSizeForViewport, getCurrentViewport, getImageSizeForViewport, getTitleSizeForViewport, roundNumber, waitForElement } from '../../utils/misc'
    
    const { season, x, y, points } = $props();
    let selectedSeason = season;
    let selectedMetricX = x;
    let selectedMetricY = y;

    const yearRange = AVAILABLE_SEASONS.length > 1 ? `${AVAILABLE_SEASONS[0]} to ${AVAILABLE_SEASONS[AVAILABLE_SEASONS.length - 1]}` : `${AVAILABLE_SEASONS[0]}`

    const availableMetricColumns = SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS.filter(m => !["fbs_class", "valid_games", "team_id", "pos_team", "division", "conference", "season"].includes(m) && !m.endsWith("_rank"))
    let availableMetricCategories: Record<string, Record<string, string>> = {
        "Differential": {},
        "Offensive - Passing": {},
        "Defensive - Passing": {},
        "Offensive - Rushing": {},
        "Defensive - Rushing": {},
        "Offensive - Other": {},
        "Defensive - Other": {}
    };

    for (const m of availableMetricColumns) {
        let category = (m.includes("_margin") || m.startsWith("net_")) ? "Differential" : ((m.includes("_off") || m.includes("off_")) ? "Offensive" : "Defensive")
        let subcat = m.includes("_pass") ? "Passing" : (m.includes("_rush") ? "Rushing" : "Other")

        const title = generateTeamMetricTitle(m)
        if (category == "Differential") {
            availableMetricCategories[category][m] = title;
        } else {
            availableMetricCategories[`${category} - ${subcat}`][m] = title;
        }
    }

    const viewport = getCurrentViewport(document, window)
    const imageSize = getImageSizeForViewport(viewport);
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    function generateChart(chartContext: HTMLElement | null, x: string, y: string) {
        const averageX = (points.map((t: any) => parseFloat(t.x)).reduce((a: number, b: number) => a + b)) / points.length
        const minX = Math.min(...points.map((t: any) => t.x))
        const maxX = Math.max(...points.map((t: any) => t.x))
        const averageY = (points.map((t: any) => parseFloat(t.y)).reduce((a: number, b: number) => a + b)) / points.length
        const minY = Math.min(...points.map((t: any) => t.y))
        const maxY = Math.max(...points.map((t: any) => t.y))
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

        const margin = 0.075
        const baseMultiplier = 0.475
        const lineMultiplier = 0.125
        const xAdjust = 0.05

        const shouldFlipYAxis = (selectedMetricY.includes("_def") && !["havoc_def", "havoc", "play_stuffed_def", "play_stuffed", "third_down_distance_def", "third_down_distance"].includes(selectedMetricY)) || (selectedMetricY.includes("_off")  && ["havoc_off", "havoc", "play_stuffed_off", "play_stuffed", "third_down_distance_off", "third_down_distance"].includes(selectedMetricY))


        const config: ChartConfiguration<'scatter' | 'line'> = {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        type: "scatter",
                        data: points.map((t: any) => { 
                            return { x: t.x, y: t.y }
                        }),
                        pointRadius: imageSize / 2,
                        pointStyle: points.map((t: any) => {
                            const img = new Image(imageSize, imageSize)
                            if (Object.keys(SPECIAL_IMAGES).includes(String(t.team_id))) {
                                img.src = SPECIAL_IMAGES[t.team_id];
                            } else {
                                img.src = (isDarkMode) ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${t.team_id}.png` : `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.team_id}.png`
                            }
                            return img
                        }),
                        showLine: false,
                        fill: false,
                    },
                    {
                        type: "line",
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
                        // clip: true
                    },
                    {
                        type: "line",
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
                        // clip: true
                    }
                ]
            },
            plugins: [{
                id: "captions-plugin",
                beforeDatasetsDraw: (chart: any) => {
                    if (viewport == "xl" || viewport == "lg") {
                        let sizeWidth = chart.ctx.canvas.clientWidth;
                        let sizeHeight = chart.ctx.canvas.clientHeight;

                        /* credit */
                        if (selectedMetricX.includes("_adj_") || selectedMetricX.startsWith("adj_") || selectedMetricY.includes("_adj_") || selectedMetricY.startsWith("adj_")) {
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
                        chart.ctx.fillText("and Saiem Gilani (@saiemgilani).", sizeWidth * (margin - 0.02), (baseMultiplier - (lineMultiplier)) * (sizeHeight / 8))
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
                responsive: true,
                scales: {
                    x: {
                        grid: {
                            color: (line) => {
                                if (line.tick.value == 0) {
                                    return (isDarkMode) ? "#8D8D8D" : "#AAAAAA"
                                }
                                return (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                            },
                        },
                        title: {
                        display: true,
                            text: generateTeamMetricTitle(selectedMetricX),
                            color: (isDarkMode) ? '#e8e6e3' : '#525252',
                            font: {
                                size: getAxisTitleSizeForViewport(viewport),
                                family: '"Chivo", "Fira Mono", serif',
                                style: "oblique"
                            }
                        },
                        type: 'linear',
                        position: 'bottom',
                        ticks: {
                            color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                        },
                        suggestedMax: suggestedRange.max.x,
                        suggestedMin: suggestedRange.min.x
                    },
                    y: {
                        reverse: shouldFlipYAxis,
                        grid: {
                            color: (line) => {
                                if (line.tick.value == 0) {
                                    return (isDarkMode) ? "#8D8D8D" : "#AAAAAA"
                                }
                                return (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                            },
                        },
                        title: {
                        display: true,
                            text: generateTeamMetricTitle(selectedMetricY),
                            color: (isDarkMode) ? '#e8e6e3' : '#525252',
                            font: {
                                size: getAxisTitleSizeForViewport(viewport),
                                family: '"Chivo", "Fira Mono", serif',
                                style: "oblique"
                            }
                        },
                        type: 'linear',
                        position: 'bottom',
                        ticks: {
                            color: (isDarkMode) ? "#8D8D8D" : "#E5E5E5"
                        },
                        suggestedMax: suggestedRange.max.y,
                        suggestedMin: suggestedRange.min.y
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: `${generateTeamMetricTitle(selectedMetricX)} vs ${generateTeamMetricTitle(selectedMetricY)} - ${selectedSeason}`,
                        color: (isDarkMode) ? "white" : "black",
                        font: {
                            size: getTitleSizeForViewport(viewport),
                            family: '"Chivo", "Fira Mono", serif'
                        },
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                return points[items[0].dataIndex].pos_team
                            },
                            label: (item) => {
                                const lines = [
                                    `${generateTeamMetricTitle(selectedMetricX)}: ${formatNumberForMetric(selectedMetricX, item.parsed.x)},`,
                                    `${generateTeamMetricTitle(selectedMetricY)}: ${formatNumberForMetric(selectedMetricY, item.parsed.y)}`
                                ] 
                                return lines.join("\n")
                            }
                        }
                    }
                }
            }
        }
        // Stores the controller so that the chart initialization routine can look it up
        new Chart(
            chartContext as ChartItem,
            config
        )
    }

    async function waitToGenerateChart() {
        try {
            const context = await waitForElement(document, "metric_chart_canvas")
            generateChart(context, selectedMetricX, selectedMetricY)
        } catch (e) {
            console.error(e);
            const container = document.getElementById("chart_container");
            if (container) {
                container.innerHTML = `<p class='m-0 mb-3 text-muted text-small'>Unable to generate chart. Please reach out to <a href="https://bsky.app/profile/akeaswaran.me">@akeaswaran.me</a> or <a href="https://bsky.app/profile/saiemgilani.bsky.social">@saiemgilani</a> on Bluesky with the page and chart options you're trying to access.</p>`
            }
        }
    }

    async function onChangeSeason(e: Event) {
        selectedSeason = e.target.value
    }

    async function onChangeMetricX(e: Event) {
        selectedMetricX = e.target.value
    }

    async function onChangeMetricY(e: Event) {
        selectedMetricY = e.target.value
    }

    async function onSubmit(e: Event) {
        e.preventDefault()
        const urlParams = new URLSearchParams({
            season: selectedSeason,
            x: selectedMetricX,
            y: selectedMetricY
        })
        window.location = `/charts/builder?${urlParams.toString()}`
    }

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
<div class="container">
<div class="row mb-3">
        <div class="col-lg-6 col-xs-12 mb-xs-3">
            <h1>Chart Builder</h1>
            <p class="m-0 text-muted"><strong>Available Seasons:</strong> {yearRange} - Data shown is from FBS vs FBS games only.</p>
            <p class="m-0 mb-2 text-muted text-small">Data from <a href="https://github.com/sportsdataverse/cfbfastR">cfbfastR</a>, may differ from ESPN due to data availability/quality. Note: other than for Adj EPA/Play, metrics are <strong>not</strong> adjusted for quality of opponent or garbage time.</p>
            <p class="m-0 mb-2 text-muted text-small">Adj EPA/Play methodology adapted from <a href="https://makennnahack.github.io/makenna-hack.github.io/publications/opp_adj_rank_project/">this article</a> by <a href="https://twitter.com/makennnahack">Makenna Hack</a> and <a href="https://blog.collegefootballdata.com/opponent-adjusted-stats-ridge-regression/">this article</a> from <a href="https://twitter.com/jbuddavis">Bud Davis</a>, accounting for home-field advantage, quality of opponent, and garbage time. Only considers FBS vs FBS games -- as a result, adj EPA/Play and normal EPA/Play numbers may differ significantly until all teams have played multiple FBS vs FBS games.</p>
            <p class="m-0 mb-2 text-muted text-small">Note: this page is best viewed on desktop.</p>
        </div>
        <div class="ms-auto col-lg-6 col-xs-12">
            <form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start">
                <div class="col-lg-auto mx-sx-0 mx-sm-2">
                    <select class="form-select form-select-md" onchange={onChangeSeason}>
                        <option value="-1" disabled>Choose Season...</option>
                        {#each AVAILABLE_SEASONS as s}
                            <option value={s} selected={(selectedSeason == s)}>{s}</option>
                        {/each}
                    </select>
                </div>
            </form>
            <form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start">
                <div class="col-auto mb-xs-3 mb-sm-0 mx-sx-0 mx-sm-2" onchange={onChangeMetricX}>
                    <select class="form-select form-select-md">
                        <option value="-1" disabled>Choose X-Axis Metric...</option>
                        {#each Object.entries(availableMetricCategories) as [cat, metrics]}
                            <optgroup label={cat}>
                                {#each Object.entries(metrics) as [metric, title]}
                                    <option value={metric} selected={(metric == selectedMetricX)}>{title}</option>
                                {/each}
                            </optgroup>
                        {/each}
                    </select>
                </div>
            </form>
            <form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start">
                <div class="col-auto mb-xs-3 mb-sm-0 mx-sx-0 mx-sm-2" onchange={onChangeMetricY}>
                    <select class="form-select form-select-md">
                        <option value="-1" disabled>Choose Y-Axis Metric...</option>
                        {#each Object.entries(availableMetricCategories) as [cat, metrics]}
                            <optgroup label={cat}>
                                {#each Object.entries(metrics) as [metric, title]}
                                    <option value={metric} selected={(metric == selectedMetricY)}>{title}</option>
                                {/each}
                            </optgroup>
                        {/each}
                    </select>
                </div>
            </form>
            <div class="mb-3 d-flex justify-content-lg-end justify-content-xs-start  mb-xs-3 mb-sm-0 mx-sx-0 mx-sm-2">
                <!-- <a href="#" class="btn btn-md btn-secondary me-2" title="Download Chart" download={`chart-${x}-${y}-${season}.jpg`} id="chart-download">Download Chart</a> -->
                <button onclick={onSubmit} class="btn btn-md btn-primary" title="Generate">Generate</button>
            </div>
        </div>
    </div>
</div>

<div class="container" id="chart_container">
    <canvas id="metric_chart_canvas" class="mb-3" style="display: block; box-sizing: border-box; height: 1200px; width: 800px;"  width="1200" height="800"></canvas>
</div>