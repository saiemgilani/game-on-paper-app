<script lang="ts">
    import { describeSignature, renderShootingSignature, SIGNATURE_VIEWBOX, type ShootingSignatureData } from '../../../nba/charts/shootingSignature';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, title }: { data: ShootingSignatureData; title: string } = $props();
    const draw: Draw = $derived((svg, width, animate) => renderShootingSignature(svg, data, { width, animate }));
</script>

<ChartSvg {draw} viewBox={SIGNATURE_VIEWBOX} {title} desc={describeSignature(data)} />
