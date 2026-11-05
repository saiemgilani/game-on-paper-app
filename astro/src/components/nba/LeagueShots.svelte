<script lang="ts">
    // BB-G16: every team's square chart, small multiples. One key for the page; each chart links to its team's full chart.
    import { select } from 'd3-selection';
    import type { Court } from '../../basketball/config';
    import { COURT_VIEWBOX } from '../../nba/charts/court';
    import { renderSquareMultiple, type SquareCell } from '../../nba/charts/hexShotChart';
    import { chartTheme, drawDiffLegend, SHRINK_NOTE, setViewBox } from '../../nba/charts/theme';
    import { fmtInt, fmtPct } from '../../nba/format';
    import type { Draw } from './chartFrame';
    import ChartSvg from './charts/ChartSvg.svelte';

    interface SmallTeam { id: number; tricode: string; name: string; href: string | null; attempts: number; fgPct: number | null; cells: SquareCell[] | null }
    let { teams, side, cap, court }: { teams: SmallTeam[]; side: number; cap: number; court?: Court } = $props();

    const drawKey: Draw = (svg, width) => {
        const g = select(svg).append('g').attr('transform', 'translate(0,4)');
        const used = drawDiffLegend(g, 0, 0, width, chartTheme(svg), [SHRINK_NOTE, `square size: attempts, full size at ${cap}+ (single attempts not drawn)`]);
        setViewBox(svg, width, used + 8);
        return () => g.remove();
    };
    const drawTeam = (cells: SquareCell[]): Draw => (svg, width) => renderSquareMultiple(svg, cells, { width, side, cap, court });
</script>

<div class="mb-3" style="max-width: 420px">
    <ChartSvg draw={drawKey} viewBox={{ width: 420, height: 60 }} title="Colour and size key" desc="Green squares beat the league's FG% from that square, purple trail it; bigger squares hold more attempts." />
</div>
<div class="row row-cols-2 row-cols-md-3 row-cols-xl-5 g-3" id="league-shots">
    {#each teams as t (t.id)}
        <div class="col">
            <div class="card h-100">
                <div class="card-body p-2">
                    <p class="h6 mb-1 text-truncate">
                        {#if t.href}<a href={t.href}>{t.tricode}</a>{:else}{t.tricode}{/if} <span class="fw-normal text-muted small">{t.name}</span>
                    </p>
                    <p class="small mb-1 numeral">{fmtInt(t.attempts)} FGA &middot; {fmtPct(t.fgPct)} FG</p>
                    {#if t.cells === null}
                        <p class="small text-muted mb-0">Shots unavailable right now.</p>
                    {:else}
                        <ChartSvg draw={drawTeam(t.cells)} viewBox={COURT_VIEWBOX} title={`${t.name} shot chart`} desc={`${fmtInt(t.attempts)} attempts; ${t.cells.length} squares with 2 or more.`} />
                    {/if}
                </div>
            </div>
        </div>
    {/each}
</div>
