<script lang="ts">
    import Chart from 'chart.js/auto';
    import { color } from 'chart.js/helpers';
    import { averageAxisBounds, type OpponentBar } from '../../utils/gameSet';
    import { formatMetricValue, generateTeamMetricTitle, type MetricFormat } from '../../utils/misc';

    type Average = { raw: number | null, margin: number | null };
    type Colors = Record<'light' | 'dark', { bar: string, line: string }>;
    const { epaBars, successBars, epaAvg, successAvg, colors }: { epaBars: OpponentBar[], successBars: OpponentBar[], epaAvg: Average, successAvg: Average, colors: Colors } = $props();

    // keys from the metric register, so the titles match the leaderboards'
    const METRICS: Record<string, { bars: OpponentBar[], avg: Average, format: MetricFormat }> = $derived({
        EPAplay: { bars: epaBars, avg: epaAvg, format: 'num2' },
        success: { bars: successBars, avg: successAvg, format: 'pct' },
    });
    let metric = $state('EPAplay');
    let view: 'raw' | 'margin' = $state('raw');
    const selected = $derived(METRICS[metric]);
    const title = $derived(generateTeamMetricTitle(`${metric}_${view === 'raw' ? 'off' : 'margin'}`));
    const average = $derived(selected.avg[view]);
    const fmt = (v: unknown) => formatMetricValue(v, selected.format, view === 'margin');

    // redraw when the OS theme flips, as the site's other themed charts do
    // (WinProbabilityChart, ExpectedPointsChart, MatchupRadarChart, DriveChart)
    let dark = $state(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $effect(() => {
        const scheme = window.matchMedia('(prefers-color-scheme: dark)');
        const flip = () => (dark = scheme.matches);
        scheme.addEventListener('change', flip);
        return () => scheme.removeEventListener('change', flip);
    });

    let canvas: HTMLCanvasElement;
    $effect(() => {
        const { bars } = selected;
        const line = average;
        // the theme's own text colour, so the axes follow dark-*.css like the page does
        const style = getComputedStyle(canvas);
        const ink = style.color;
        const faint = color(ink).alpha(0.2).rgbString();
        const font = { family: style.fontFamily };
        const pair = dark ? colors.dark : colors.light;
        const chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: bars.map((b) => b.label),
                datasets: [{ data: bars.map((b) => b[view]), backgroundColor: pair.bar, borderColor: pair.bar }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ...averageAxisBounds(line),
                        title: { display: true, text: title, color: ink, font: { ...font, style: 'oblique' } },
                        ticks: { color: ink, font, callback: (v) => fmt(v) },
                        grid: { color: (c) => (c.tick?.value === 0 ? ink : faint) },
                    },
                    y: { ticks: { color: ink, font, autoSkip: false }, grid: { display: false } },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => bars[items[0].dataIndex].title,
                            label: (item) => `${title}: ${fmt(item.parsed.x)}`,
                        },
                    },
                },
            },
            plugins: [{
                // the season average: ChartBuilder's dashed average line, across the bars
                id: 'season-average',
                afterDraw: (c) => {
                    if (line === null) return;
                    const x = c.scales.x.getPixelForValue(line);
                    const ctx = c.ctx;
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, c.chartArea.top);
                    ctx.lineTo(x, c.chartArea.bottom);
                    ctx.strokeStyle = pair.line;
                    ctx.globalAlpha = 0.75;
                    ctx.setLineDash([5, 15]);
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();
                },
            }],
        });
        return () => chart.destroy();
    });
</script>

<div class="d-flex flex-wrap gap-2 align-items-center mb-2 mt-1">
    <select id="vs-opponent-metric" aria-label="Metric" class="form-select form-select-sm" style="width:auto" bind:value={metric}>
        {#each Object.keys(METRICS) as m}
        <option value={m}>{generateTeamMetricTitle(m)}</option>
        {/each}
    </select>
    <select id="vs-opponent-view" aria-label="Raw value or margin" class="form-select form-select-sm" style="width:auto" bind:value={view}>
        <option value="raw">Raw</option>
        <option value="margin">Margin</option>
    </select>
    <span class="text-small text-muted">Season average: {fmt(average)}</span>
</div>
<div style={`position: relative; height: ${selected.bars.length * 28 + 70}px`}>
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>
<!-- the chart's data for screen readers: the canvas is pixels and its tooltips need a pointer -->
<table class="visually-hidden">
    <caption>{title} by game. Season average: {fmt(average)}</caption>
    <thead><tr><th scope="col">Game</th><th scope="col">{title}</th></tr></thead>
    <tbody>
        {#each selected.bars as b}
        <tr><th scope="row">{b.title}</th><td>{fmt(b[view])}</td></tr>
        {/each}
    </tbody>
</table>
