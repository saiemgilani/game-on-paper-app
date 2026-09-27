<script>
    // Admin tool: flip ONE preview flag for this request. Same shape as the
    // leaderboards' metric dropdowns -- a select that navigates -- because that
    // is how this site switches a dimension. Each option carries the URL the
    // Astro side already composed, so the flag state lives in the query string
    // and nothing is held client-side.
    const { options } = $props()

    function onChange(e) {
        const href = e.target.value;
        if (href) window.location = href;
    }
</script>
<select class="form-select form-select-sm w-auto" aria-label="Override a preview flag" onchange={onChange}>
    <option value="">Flags: override one...</option>
    {#each options as o}
        <option value={o.href}>{o.name}: {o.effective ? "on" : "off"} to {o.effective ? "off" : "on"}</option>
    {/each}
</select>
