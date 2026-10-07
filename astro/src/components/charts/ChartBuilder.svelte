<script lang="ts">
    import Chart from 'chart.js/auto';
    import { espnLogoLeague, leagueFromLocation, leaguePath, teamLogoUrl } from '../../utils/league';
    import { type ChartConfiguration, type ChartItem } from 'chart.js';
    import { AVAILABLE_SEASONS, SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS, SPECIAL_IMAGES, SPECIAL_IMAGES_DARK } from '../../utils/constants';
    import { formatNumberForMetric, generateTeamMetricTitle, getAxisTitleSizeForViewport, getCurrentViewport, getImageSizeForViewport, getTitleSizeForViewport, roundNumber, waitForElement, shouldInvertSortForMetric, generateCategoryForMetric, generateSubCategoryForMetric, STANDARD_THEME_COLOR, cleanField, generateColorRampValue, isTeamFavorite } from '../../utils/misc'
    import "bootstrap-icons/font/bootstrap-icons.css";
    import { builderUrl, CHART_TEXT, chartTitle, keepPreviewSurface, median, metricRail, quadrantLabels, randomAxes } from '../../utils/chartBuilder';

    // `league` comes from the SSR page; the FBS group/conference filters and
    // copy only make sense for college football
    const { season, x, y, points, league = 'cfb', v2 = false, highlight = '', mode = 'logos' } = $props();
    let selectedSeason = season;
    let selectedMetricX = x;
    let selectedMetricY = y;

    // v2 ('chart-builder-v2'): one click on the rail or Random navigates, carrying the v2 view state
    const rail = metricRail();
    const railKeys = rail.flatMap((f) => f.metrics.map((m) => m.key));
    function go(nx: string, ny: string) {
        const target = builderUrl(league, { season: selectedSeason, x: nx, y: ny, hl: highlight, mode });
        window.location.href = keepPreviewSurface(target, window.location.pathname);
    }
    function onRandom() {
        const [nx, ny] = randomAxes(railKeys);
        go(nx, ny);
    }

    let conferenceList = [...new Set(points.map(p => p.conference))].sort()

    let selectedSort = $state("x");
    let selectedFBSClassFilter = $state("all");
    let selectedConferenceFilter = $state("all");
    let flipArrow = $derived((selectedSort == "x") ? shouldInvertSortForMetric(selectedMetricX.includes("_def") ? "defensive" : "offensive", selectedMetricX) : shouldInvertSortForMetric(selectedMetricY.includes("_def") ? "defensive" : "offensive", selectedMetricY))
    let chartedPoints = $derived(
        points
            .filter((p) => (selectedFBSClassFilter == "all") || (selectedFBSClassFilter == p.fbs_class))
            .filter((p) => (selectedConferenceFilter == "all") || (selectedConferenceFilter == p.conference))
            .toSorted((a, b) => flipArrow ? (a[selectedSort] - b[selectedSort]) : (b[selectedSort] - a[selectedSort]))
    )

    const yearRange = AVAILABLE_SEASONS.length > 1 ? `${AVAILABLE_SEASONS[0]} to ${AVAILABLE_SEASONS[AVAILABLE_SEASONS.length - 1]}` : `${AVAILABLE_SEASONS[0]}`

    const availableMetricColumns = SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS.filter(m => !["fbs_class", "valid_games", "team_id", "pos_team", "division", "conference", "season"].includes(m) && !m.endsWith("_rank"))
    let availableMetricCategories: Record<string, Record<string, string>> = {
        "Differential - Passing": {},
        "Differential - Rushing": {},
        "Differential - Other": {},
        "Offensive - Passing": {},
        "Defensive - Passing": {},
        "Offensive - Rushing": {},
        "Defensive - Rushing": {},
        "Offensive - Other": {},
        "Defensive - Other": {}
    };

    for (const m of availableMetricColumns) {
        if (m.includes("passrate") && m.includes("_rush")) {
            continue
        }

        if (m.includes("rushrate") && m.includes("_pass")) {
            continue
        }
        
        let category = generateCategoryForMetric(m)
        let subcat = generateSubCategoryForMetric(m)
        const title = generateTeamMetricTitle(m)
        availableMetricCategories[`${category} - ${subcat}`][m] = title;
    }

    const viewport = getCurrentViewport(document, window)
    const imageSize = getImageSizeForViewport(viewport);
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let builderChart: Chart | null = null;

    function generateChart(chartContext: HTMLElement | null, x: string, y: string) {
        const averageX = (chartedPoints.map((t: any) => parseFloat(t.x)).filter((t: any) => !!t).reduce((a: number, b: number) => a + b)) / chartedPoints.length
        const minX = Math.min(...chartedPoints.map((t: any) => t.x))
        const maxX = Math.max(...chartedPoints.map((t: any) => t.x))
        const averageY = (chartedPoints.map((t: any) => parseFloat(t.y)).filter((t: any) => !!t).reduce((a: number, b: number) => a + b)) / chartedPoints.length
        const minY = Math.min(...chartedPoints.map((t: any) => t.y))
        const maxY = Math.max(...chartedPoints.map((t: any) => t.y))
        // v2 draws the MEDIAN crosshair (quadrants split the field in half); the public builder keeps its mean.
        // A team with no value (null) is skipped by median(), never read as 0.
        const centerX = v2 ? (median(chartedPoints.map((t: any) => t.x)) ?? averageX) : averageX;
        const centerY = v2 ? (median(chartedPoints.map((t: any) => t.y)) ?? averageY) : averageY;
        console.log(`X: avg - ${averageX}, min - ${minX}, max - ${maxX}`)
        console.log(`Y: avg - ${averageY}, min - ${minY}, max - ${maxY}`)

        const suggestedRange = {
            min: {
                x: minX * 1.25,
                y: minY * 1.25,
            },
            max: {
                x: maxX * 1.25,
                y: maxY * 1.25
            }
        }

        const margin = 0.075
        const baseMultiplier = 0.475
        const lineMultiplier = 0.125
        const xAdjust = 0.05

        const shouldFlipYAxis = shouldInvertSortForMetric(selectedMetricY.includes("_def") ? "defensive" : "offensive", selectedMetricY);
        const shouldFlipXAxis = shouldInvertSortForMetric(selectedMetricX.includes("_def") ? "defensive" : "offensive", selectedMetricX);

        const config: ChartConfiguration<'scatter'> = {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        type: "scatter",
                        data: chartedPoints.map((t: any) => { 
                            return { x: t.x, y: t.y }
                        }),
                        pointRadius: imageSize / 2,
                        pointStyle: chartedPoints.map((t: any) => {
                            const img = new Image(imageSize, imageSize)
                            if (isDarkMode && Object.keys(SPECIAL_IMAGES_DARK).includes(String(t.team_id))) {
                                img.src = SPECIAL_IMAGES_DARK[t.team_id];
                            } else if (Object.keys(SPECIAL_IMAGES).includes(String(t.team_id))) {
                                img.src = SPECIAL_IMAGES[t.team_id];
                            } else {
                                img.src = teamLogoUrl(leagueFromLocation(), t.team_id, isDarkMode)
                            }
                            return img
                        }),
                        showLine: false,
                        fill: false,
                    },
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
                            chart.ctx.fillText("Adj EPA/Play methodology adapted from Makenna Hack (@makennahack) and Bud Davis (@jbuddavis).", sizeWidth * (1 - margin + xAdjust), (baseMultiplier - lineMultiplier) * (sizeHeight / 8))
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

                        // show filters
                        chart.ctx.save()
                        chart.ctx.textAlign = "right"
                        chart.ctx.font = "8px Helvetica";
                        chart.ctx.globalAlpha = 0.75;
                        chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                        chart.ctx.fillText(`Filters: FBS groups - ${selectedFBSClassFilter}, Conferences - ${selectedConferenceFilter}`, sizeWidth * (1 - margin + xAdjust), (baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8))
                        chart.ctx.restore();

                        if (shouldFlipYAxis && !shouldFlipXAxis) {
                            chart.ctx.save()
                            chart.ctx.textAlign = "right"
                            chart.ctx.font = "italic 8px Helvetica";
                            chart.ctx.globalAlpha = 0.5;
                            chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                            chart.ctx.fillText("NOTE: y-axis is flipped to ensure 'good' performances are", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (lineMultiplier)) * (sizeHeight / 8)))
                            chart.ctx.fillText("towards the top and 'bad' performances are towards the bottom.", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8)))
                            chart.ctx.restore();
                        } else if (shouldFlipXAxis && !shouldFlipYAxis) {
                            chart.ctx.save()
                            chart.ctx.textAlign = "right"
                            chart.ctx.font = "italic 8px Helvetica";
                            chart.ctx.globalAlpha = 0.5;
                            chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                            chart.ctx.fillText("NOTE: x-axis is flipped to ensure 'good' performances are", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (lineMultiplier)) * (sizeHeight / 8)))
                            chart.ctx.fillText("towards the right and 'bad' performances are towards the left.", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8)))
                            chart.ctx.restore();
                        } else if (shouldFlipXAxis && shouldFlipYAxis) {
                            chart.ctx.save()
                            chart.ctx.textAlign = "right"
                            chart.ctx.font = "italic 8px Helvetica";
                            chart.ctx.globalAlpha = 0.5;
                            chart.ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e8e6e3' : '#525252';
                            chart.ctx.fillText("NOTE: both axes are flipped to ensure 'good' performances are", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (lineMultiplier)) * (sizeHeight / 8)))
                            chart.ctx.fillText("towards the top-right and 'bad' performances are towards the bottom-left.", sizeWidth * (1 - margin + xAdjust), (sizeHeight * 0.95) - ((baseMultiplier - (2 * lineMultiplier)) * (sizeHeight / 8)))
                            chart.ctx.restore();
                        }
                    }
                },
                afterDraw: (chart) => {
                    const yValue = chart.scales.y.getPixelForValue(centerY);
                    const xValue = chart.scales.x.getPixelForValue(centerX);

                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(chart.chartArea.left, yValue);
                    ctx.lineTo(chart.chartArea.right, yValue);
                    ctx.strokeStyle = STANDARD_THEME_COLOR;
                    ctx.globalAlpha = 0.75;
                    ctx.setLineDash([5, 15]);
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();

                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(xValue, chart.chartArea.top);
                    ctx.lineTo(xValue, chart.chartArea.bottom);
                    ctx.strokeStyle = STANDARD_THEME_COLOR;
                    ctx.globalAlpha = 0.75;
                    ctx.setLineDash([5, 15]);
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();

                    if (v2) {
                        const area = chart.chartArea;
                        const q = quadrantLabels(generateTeamMetricTitle(selectedMetricX), generateTeamMetricTitle(selectedMetricY));
                        ctx.save();
                        ctx.fillStyle = isDarkMode ? CHART_TEXT.dark : CHART_TEXT.light;
                        ctx.font = 'bold 11px "Chivo", "Fira Mono", serif';
                        ctx.textAlign = 'left';
                        ctx.fillText(`MEDIAN ${formatNumberForMetric(selectedMetricY, centerY)}`, area.left + 4, yValue - 4);
                        ctx.textAlign = 'center';
                        ctx.fillText(`MEDIAN ${formatNumberForMetric(selectedMetricX, centerX)}`, xValue, area.bottom - 4);
                        ctx.font = '11px "Chivo", "Fira Mono", serif';
                        ctx.globalAlpha = 0.6;
                        // two labels share each edge: draw them only where they fit side by side (not on a phone-width chart)
                        const widest = Math.max(...Object.values(q).map((t) => ctx.measureText(t).width));
                        if (2 * widest + 16 < area.right - area.left) {
                            ctx.textAlign = 'right';
                            ctx.fillText(q.topRight, area.right - 4, area.top + 12);
                            ctx.fillText(q.bottomRight, area.right - 4, area.bottom - 18);
                            ctx.textAlign = 'left';
                            ctx.fillText(q.topLeft, area.left + 4, area.top + 12);
                            ctx.fillText(q.bottomLeft, area.left + 4, area.bottom - 18);
                        }
                        ctx.restore();
                    }
                }
            }],
            options: {
                responsive: true,
                scales: {
                    x: {
                        reverse: shouldFlipXAxis,
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
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: v2 ? chartTitle(selectedMetricX, selectedMetricY, selectedSeason, selectedFBSClassFilter !== 'all' || selectedConferenceFilter !== 'all') : `${generateTeamMetricTitle(selectedMetricX)} vs ${generateTeamMetricTitle(selectedMetricY)} - ${selectedSeason}`,
                        color: (isDarkMode) ? "white" : "black",
                        // v2's chart is a column narrower: drop the title below the credit lines (drawn on lg/xl only)
                        ...(v2 && (viewport == "xl" || viewport == "lg") ? { padding: { top: 34, bottom: 10 } } : {}),
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
                                return chartedPoints[items[0].dataIndex].pos_team
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
        
        if (!builderChart) {
            // Stores the controller so that the chart initialization routine can look it up
            builderChart = new Chart(
                chartContext as ChartItem,
                config
            )
        } else {
            console.log("reloading data with new config")
            builderChart.data = config.data
            builderChart.plugins = config.plugins
            builderChart.options = config.options
            builderChart.update()
        }
    }

    async function waitToGenerateChart() {
        try {
            const context = await waitForElement(document, "metric_chart_canvas")
            if (chartedPoints.length == 0) {
                throw new Error("Unable to generate chart, no points available.")
            }
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

    async function onChangeConferenceFilter(e: Event) {
        selectedConferenceFilter = e.target.value
        waitToGenerateChart()
    }

    async function onChangeFBSClassFilter(e: Event) {
        selectedFBSClassFilter = e.target.value
        waitToGenerateChart()
    }

    async function onSubmit(e: Event) {
        e.preventDefault()
        const urlParams = new URLSearchParams({
            season: selectedSeason,
            x: selectedMetricX,
            y: selectedMetricY
        })
        window.location = leaguePath(league, `/charts/builder?${urlParams.toString()}`)
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
            <p class="m-0 text-muted"><strong>Available Seasons:</strong> {yearRange}{league === 'cfb' ? ' - Data shown is from FBS vs FBS games only.' : ''}</p>
            <p class="m-0 mb-2 text-muted text-small">Data from <a href="https://www.sportsdataverse.org">Sportsdataverse</a>, may differ from ESPN due to data availability/quality. Note: other than for Adj EPA/Play, metrics are <strong>not</strong> adjusted for quality of opponent or garbage time.</p>
            <p class="m-0 mb-2 text-muted text-small">Adj EPA/Play methodology adapted from <a href="https://makennnahack.github.io/makenna-hack.github.io/publications/opp_adj_rank_project/">this article</a> by <a href="https://twitter.com/makennnahack">Makenna Hack</a> and <a href="https://blog.collegefootballdata.com/opponent-adjusted-stats-ridge-regression/">this article</a> from <a href="https://twitter.com/jbuddavis">Bud Davis</a>, accounting for home-field advantage, quality of opponent, and garbage time. Only considers FBS vs FBS games -- as a result, adj EPA/Play and normal EPA/Play numbers may differ significantly until all teams have played multiple FBS vs FBS games.</p>
            <p class="m-0 mb-2 text-muted text-small">Note: this page is best viewed on desktop.</p>
        </div>
        <div class="ms-auto col-lg-6 col-xs-12">
            <form class="mb-3 d-flex justify-content-xs-start justify-content-md-end">
                <div class="col-lg-auto mx-sx-0 mx-sm-2">
                    <select class="form-select form-select-md" onchange={(e) => { onChangeSeason(e); if (v2) go(selectedMetricX, selectedMetricY); }}>
                        <option value="-1" disabled>Choose Season...</option>
                        {#each AVAILABLE_SEASONS as s}
                            <option value={s} selected={(selectedSeason == s)}>{s}</option>
                        {/each}
                    </select>
                </div>
            </form>
            {#if !v2}
            <form class="mb-3 d-flex justify-content-xs-start justify-content-md-end">
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
            <form class="mb-3 d-flex justify-content-xs-start justify-content-md-end">
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
            <div class="mb-3 d-flex justify-content-xs-start justify-content-md-end  mb-xs-3 mb-sm-0 mx-sx-0 mx-sm-2">
                <!-- <a href="#" class="btn btn-md btn-secondary me-2" title="Download Chart" download={`chart-${x}-${y}-${season}.jpg`} id="chart-download">Download Chart</a> -->
                <button onclick={onSubmit} class="btn btn-md btn-primary" title="Generate">Generate</button>
            </div>
            {/if}
        </div>
    </div>
</div>

{#if v2}
<div class="container mb-3">
    <div class="row">
        <div class="col-lg-3 col-12 mb-3 order-2 order-lg-1" id="metric-rail">
            <div class="mb-2">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="random-axes" onclick={onRandom}>Random</button>
            </div>
            {#each rail as fam}
            <details open={fam.metrics.some((m) => m.key === selectedMetricX || m.key === selectedMetricY)}>
                <summary class="text-small">{fam.family}</summary>
                <table class="table table-sm mb-2">
                    <thead>
                        <tr><th></th><th class="text-center text-muted text-small">X</th><th class="text-center text-muted text-small">Y</th></tr>
                    </thead>
                    <tbody>
                    {#each fam.metrics as m}
                        <tr data-rail-metric={m.key}>
                            <td class="text-left">{m.title}</td>
                            <td class="text-center"><input class="form-check-input" type="radio" name="rail-x" aria-label={`X axis: ${m.title}`} checked={m.key === selectedMetricX} onchange={() => go(m.key, selectedMetricY)} /></td>
                            <td class="text-center"><input class="form-check-input" type="radio" name="rail-y" aria-label={`Y axis: ${m.title}`} checked={m.key === selectedMetricY} onchange={() => go(selectedMetricX, m.key)} /></td>
                        </tr>
                    {/each}
                    </tbody>
                </table>
            </details>
            {/each}
        </div>
        <div class="col-lg-9 col-12 order-1 order-lg-2" id="chart_container">
            <canvas id="metric_chart_canvas" class="mb-3" width="1200" height="800"></canvas>
        </div>
    </div>
</div>
{:else}
<div class="container mb-3" id="chart_container">
    <canvas id="metric_chart_canvas" class="mb-3" style="display: block; box-sizing: border-box; height: 1200px; width: 800px;"  width="1200" height="800"></canvas>
</div>
{/if}
<div class="container mb-3">
    <div class="row d-flex">
        <div class="col-xs-12 col-sm-auto mb-xs-1 mb-sm-3 mx-xs-0 mx-sm-1 d-flex justify-content-start">
            <span class="align-self-center">Focus on:</span>
        </div>
        
        {#if league === 'cfb'}
        <form class="col-xs-12 col-sm-auto mb-3 mr-xs-0 mr-sm-2 d-flex justify-content-start">
            <select class="form-select form-select-md" onchange={onChangeFBSClassFilter}>
                <option value="-1" disabled>Focus on FBS group...</option>
                <option value="all">All FBS Groups</option>
                {#if selectedSeason >= 2024}
                <option value="G6" selected={selectedFBSClassFilter == "G6"}>Group of 6</option>
                <option value="P4" selected={selectedFBSClassFilter == "P4"}>Power 4 + ND</option>
                {/if}
                {#if selectedSeason < 2024}
                <option value="G5" selected={selectedFBSClassFilter == "G5"}>Group of 5</option>
                <option value="P5" selected={selectedConferenceFilter == "P5"}>Power 5 + ND</option>
                {/if}
            </select>
            
        </form>
        <form class="col-xs-12 col-sm-auto mb-3 mr-xs-0 mr-sm-2 d-flex justify-content-start" onchange={onChangeConferenceFilter}>
            <select class="form-select form-select-md">
                <option value="-1" disabled>Focus on FBS conference...</option>
                <option value="all">All FBS Conferences</option>
                {#each conferenceList as c}
                <option value={c} selected={selectedConferenceFilter == c}>{c}</option>
                {/each}
            </select>
        </form>
        {/if}
    </div>
</div>

<div class="container" id="points_table">
    <div class="row">
        <div class="col-12">
            <p class="text-muted text-small">Tap/click on the metric titles to sort the table.</p>
            <div class="table">
                <table class="table table-responsive table-sm">
                    <thead>
                        <tr>
                            <th class="text-right" colspan="1">Rk</th>
                            <th class="text-left" colspan="1">Team</th>
                            <th class="text-center" colspan="1">
                                <a href="#points_table" style={isDarkMode ? "color: #e8e6e3" : "color: #212529"} onclick={() => { selectedSort = "x" }}>{generateTeamMetricTitle(selectedMetricX)}</a>
                                <i hidden={selectedSort != "x"} class={`bi-arrow-${flipArrow ? "up" : "down"}`}></i>
                            </th>
                            <th class="text-center" colspan="1">
                                <a href="#points_table" style={isDarkMode ? "color: #e8e6e3" : "color: #212529"} onclick={() => { selectedSort = "y" }}>{generateTeamMetricTitle(selectedMetricY)}</a>
                                <i hidden={selectedSort != "y"} class={`bi-arrow-${flipArrow ? "up" : "down"}`}></i>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each chartedPoints as p, i}
                        <tr>
                            <td class="text-right" colspan="1">{i + 1}</td>
                            <td class="text-left" colspan="1"><a href={leaguePath(league, `/year/${season}/team/${p.team_id}`)}><img class={`img-fluid team-logo-${p.team_id} me-2`} width="20px" src={`https://a.espncdn.com/i/teamlogos/${espnLogoLeague(leagueFromLocation())}/500/${p.team_id}.png`} alt={`ESPN team id ${p.team_id} ${cleanField(p, "pos_team")}`} title={cleanField(p, "pos_team")}/><span class="visually-hidden">{cleanField(p, "pos_team")}</span><strong>{cleanField(p, "pos_team")}</strong></a></td>
                            <td class={`text-center ${generateColorRampValue(parseFloat(p.x_rank), points.length, true)}`} colspan="1">{formatNumberForMetric(selectedMetricX, p.x)}</td>
                            <td class={`text-center ${generateColorRampValue(parseFloat(p.y_rank), points.length, true)}`} colspan="1">{formatNumberForMetric(selectedMetricY, p.y)}</td>
                        </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>