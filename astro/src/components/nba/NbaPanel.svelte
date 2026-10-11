<script lang="ts">
    // layouts/panel/GenericPanel.astro's markup for use inside a Svelte island. Always expanded:
    // a chart measures 0 px while collapsed and would never draw, so there is no [show/hide].
    import type { Snippet } from 'svelte';
    let { id, title, children }: { id: string; title: string; children: Snippet } = $props();
</script>

<div class="panel-group" id={`${id}-panel`}>
    <div class="panel panel-default">
        <div class="panel-heading"><div class="panel-title"><h2 class="d-inline">{title}</h2></div></div>
        <div id={id} class="collapse show"><div class="panel-body">{@render children()}</div></div>
    </div>
</div>
