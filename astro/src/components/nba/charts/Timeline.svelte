<script lang="ts">
    import { describeTimeline, renderTimeline, TIMELINE_VIEWBOX } from '../../../nba/charts/timeline';
    import type { PlayerGame } from '../../../nba/data/aggregate';
    import type { DateWindow } from '../../../nba/selection';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { games, window: dateWindow, onBrush, title }: { games: PlayerGame[]; window: DateWindow; onBrush: (w: DateWindow) => void; title: string } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const g = games, w = dateWindow, b = onBrush;
        return (svg, width) => renderTimeline(svg, g, { width, window: w, onBrush: b });
    });
</script>

<ChartSvg {draw} viewBox={TIMELINE_VIEWBOX} {title} desc={describeTimeline(games, dateWindow)} />
