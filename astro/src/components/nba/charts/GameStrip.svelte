<script lang="ts">
    import { describeGames, GAME_STRIP_VIEWBOX, renderGameStrip, type GameStripData } from '../../../nba/charts/gameStrip';
    import type { DateWindow } from '../../../nba/selection';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, selected, window: dateWindow, onToggle, title }: {
        data: GameStripData; selected: ReadonlySet<string>; window: DateWindow; onToggle: (gameId: string) => void; title: string;
    } = $props();
    const draw: Draw = $derived((svg, width, animate) => renderGameStrip(svg, data, { width, selected, window: dateWindow, onToggle, animate }));
</script>

<ChartSvg {draw} viewBox={GAME_STRIP_VIEWBOX} {title} desc={describeGames(data, selected)} role="group" />
