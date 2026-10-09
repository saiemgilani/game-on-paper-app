<script lang="ts">
    import { describeGames, GAME_STRIP_VIEWBOX, renderGameStrip, type GameStripData } from '../../../nba/charts/gameStrip';
    import type { DateWindow } from '../../../nba/selection';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, selected, window: dateWindow, onToggle, title }: {
        data: GameStripData; selected: ReadonlySet<string>; window: DateWindow; onToggle: (gameId: string) => void; title: string;
    } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const d = data, s = selected, w = dateWindow, t = onToggle;
        return (svg, width, animate) => renderGameStrip(svg, d, { width, selected: s, window: w, onToggle: t, animate });
    });
</script>

<ChartSvg {draw} viewBox={GAME_STRIP_VIEWBOX} {title} desc={describeGames(data, selected)} role="group" />
