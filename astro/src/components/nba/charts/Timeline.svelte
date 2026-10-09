<script lang="ts">
    import { describeTimeline, renderTimeline, TIMELINE_VIEWBOX } from '../../../nba/charts/timeline';
    import type { PlayerGame } from '../../../nba/data/aggregate';
    import type { DateWindow } from '../../../nba/selection';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { games, window: dateWindow, onBrush, title }: { games: PlayerGame[]; window: DateWindow; onBrush: (w: DateWindow) => void; title: string } = $props();
    const draw: Draw = $derived((svg, width) => renderTimeline(svg, games, { width, window: dateWindow, onBrush }));
</script>

<ChartSvg {draw} viewBox={TIMELINE_VIEWBOX} {title} desc={describeTimeline(games, dateWindow)} />
