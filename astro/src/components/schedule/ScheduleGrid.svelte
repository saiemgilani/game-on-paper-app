<script lang="ts">
    import type { ESPNScheduleEvent } from "../../resources/espn";
    import GameThumb from "./GameThumb.svelte";
    interface Props {
        games: ESPNScheduleEvent[]
    }

    const { games } = $props();
    
</script>
<div class="row mb-3">
    {#if games.length > 0}
        {#each games as g}
            <GameThumb game={g} />
        {/each}
    {/if}
    {#if games.length == 0}
    <p class="text-center text-muted">No games scheduled.</p>
    {/if}
</div>