<script lang="ts">
    import { describeSignature, renderShootingSignature, SIGNATURE_VIEWBOX, type ShootingSignatureData } from '../../../nba/charts/shootingSignature';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, title }: { data: ShootingSignatureData; title: string } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const d = data;
        return (svg, width, animate) => renderShootingSignature(svg, d, { width, animate });
    });
</script>

<ChartSvg {draw} viewBox={SIGNATURE_VIEWBOX} {title} desc={describeSignature(data)} />
