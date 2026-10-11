<script lang="ts">
    // The six charts in the 2021 arrangement: shot chart + signature, the distance pair, the side pair.
    import type { DashboardData } from '../../nba/dashboard';
    import DistanceBars from './charts/DistanceBars.svelte';
    import HexShotChart from './charts/HexShotChart.svelte';
    import ShootingSignature from './charts/ShootingSignature.svelte';
    import SideChart from './charts/SideChart.svelte';
    import NbaPanel from './NbaPanel.svelte';
    let { data, subject, subjectLabel = 'Player' }: { data: DashboardData; subject: string; subjectLabel?: 'Player' | 'Team' } = $props();
</script>

<div class="row g-3">
    <div class="col-12 col-md-6"><NbaPanel id="nba-hex" title="Shot chart"><HexShotChart data={data.hex} title={`${subject} shot chart`} /></NbaPanel></div>
    <div class="col-12 col-md-6"><NbaPanel id="nba-signature" title="Shooting signature"><ShootingSignature data={data.signature} title={`${subject} FG% by distance vs league`} /></NbaPanel></div>
    <div class="col-12 col-md-6"><NbaPanel id="nba-share" title="Shot proportion by distance"><DistanceBars data={data.bars} metric="share" {subjectLabel} title={`${subject} share of shots by distance vs league`} /></NbaPanel></div>
    <div class="col-12 col-md-6"><NbaPanel id="nba-fg-distance" title="Field goal percentage by distance"><DistanceBars data={data.bars} metric="fgPct" {subjectLabel} title={`${subject} FG% by distance vs league`} /></NbaPanel></div>
    <div class="col-12 col-md-6"><NbaPanel id="nba-side-share" title="Shooting frequency by side"><SideChart data={data.sides} metric="share" title={`${subject} share of shots left, centre and right of the hoop`} /></NbaPanel></div>
    <div class="col-12 col-md-6"><NbaPanel id="nba-side-fg" title="Field goal percentage by side"><SideChart data={data.sides} metric="fgPct" title={`${subject} FG% left, centre and right of the hoop`} /></NbaPanel></div>
</div>
