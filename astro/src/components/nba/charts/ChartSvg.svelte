<script lang="ts">
    // The shell every chart draws into: an empty, scalable <svg> with its viewBox, an accessible
    // name (<title>) and the numbers in words (<desc>). d3 appends its own <g> and removes it on cleanup.
    import { chartFrame, type Draw } from '../chartFrame';
    let { draw, viewBox, title, desc, role = 'img' }: {
        draw: Draw; viewBox: { width: number; height: number }; title: string; desc: string; role?: 'img' | 'group';
    } = $props();
</script>

<svg use:chartFrame={draw} viewBox={`0 0 ${viewBox.width} ${viewBox.height}`} {role} aria-label={title} class="nba-chart">
    <title>{title}</title>
    <desc>{desc}</desc>
</svg>
