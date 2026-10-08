<script>
    // 'share-card' (preview): share the game's link, or the ?spoilers=off link
    // whose preview leaves the score out. The Web Share sheet where the browser
    // has one; otherwise the link is copied and a toast says so. The menu opens
    // and closes itself because the pregame page loads no Bootstrap JS.
    const { url, spoilerFreeUrl, label = false } = $props();
    let open = $state(false);
    let toast = $state('');
    let root;
    let timer;

    async function share(href) {
        open = false;
        if (navigator.share) {
            try {
                await navigator.share({ url: href });
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(href);
            toast = 'Link copied';
        } catch {
            toast = href; // no clipboard: show the link to copy by hand
        }
        clearTimeout(timer);
        timer = setTimeout(() => (toast = ''), 3000);
    }
</script>

<svelte:window
    onclick={(e) => { if (open && !root.contains(e.target)) open = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') open = false; }}
/>
<div class="dropdown" bind:this={root}>
    <button class="btn btn-sm btn-outline-primary align-middle" class:p-2={label} type="button" aria-label="Share" aria-haspopup="true" aria-expanded={open} onclick={() => (open = !open)}>
        <i class="bi-share"></i>{label ? ' Share' : ''}
    </button>
    <ul class="dropdown-menu dropdown-menu-end" class:show={open} data-bs-popper="static">
        <li><button class="dropdown-item" type="button" onclick={() => share(url)}><i class="bi-link-45deg me-2"></i>Share link</button></li>
        <li>
            <button class="dropdown-item" type="button" onclick={() => share(spoilerFreeUrl)}>
                <i class="bi-eye-slash me-2"></i>Share without the score
                <span class="d-block text-muted small ms-4">Preview hides the score</span>
            </button>
        </li>
    </ul>
    {#if toast}
        <div class="toast show position-fixed bottom-0 end-0 m-3" role="status" aria-live="polite"><div class="toast-body">{toast}</div></div>
    {/if}
</div>

<style>
    /* above the phone's sticky section nav (base.css .game-nav-sticky, 1020), which
       the menu opens over; Bootstrap's 1000 put the menu under it */
    .dropdown-menu {
        z-index: 1030;
    }
</style>
