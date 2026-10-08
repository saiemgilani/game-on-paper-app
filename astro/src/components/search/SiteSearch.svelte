<script module lang="ts">
    /** The option the arrow keys land on: wraps at both ends, and from none (-1) goes to an end. */
    export function moveActive(i: number, delta: number, n: number): number {
        if (n <= 0) return -1;
        if (i < 0) return delta > 0 ? 0 : n - 1;
        return (i + delta + n) % n;
    }
</script>

<script lang="ts">
    // The header search box. The hrefs come built from /api/search, so this island needs
    // nothing from utils/ (whose imports would ride along into every page's bundle).
    type Hit = { type: 'team' | 'player' | 'game'; id: string; label: string; sublabel: string; href: string };
    const GROUPS = [['team', 'Teams'], ['player', 'Players'], ['game', 'Games']] as const;

    const { league = 'cfb', placeholder = 'Search' } = $props();

    let q = $state('');
    let hits: Hit[] = $state([]);
    let answered = $state(''); // the query `hits` answers
    let open = $state(false);
    let active = $state(-1);
    const showing = $derived(open && answered !== '');

    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    let goWhenAnswered = false;

    async function search(term: string) {
        ctrl?.abort();
        ctrl = new AbortController();
        let next: Hit[] = [];
        const params = new URLSearchParams({ q: term, league });
        // an admin's per-request ?view= / ?flags= must reach the API too, or the box an
        // override rendered would 404 (the middleware reads them only for an admin session)
        const page = new URLSearchParams(window.location.search);
        for (const k of ['view', 'flags']) if (page.has(k)) params.set(k, page.get(k)!);
        try {
            const res = await fetch(`/api/search?${params}`, { signal: ctrl.signal });
            if (res.ok) next = await res.json();
        } catch (e) {
            if ((e as Error).name === 'AbortError') return;
        }
        hits = next;
        answered = term;
        active = -1;
        if (goWhenAnswered) {
            goWhenAnswered = false;
            if (next[0]) window.location.href = next[0].href;
        }
    }

    function oninput() {
        clearTimeout(timer);
        // an edit cancels an Enter still waiting for its answer, and the highlight belonged
        // to the old answer (whose rows stay visible until the new one lands, without flicker)
        goWhenAnswered = false;
        active = -1;
        open = true;
        const term = q.trim();
        if (term.length < 2) {
            ctrl?.abort();
            hits = [];
            answered = '';
            return;
        }
        timer = setTimeout(() => search(term), 150);
    }

    function onkeydown(e: KeyboardEvent) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) {
            e.preventDefault();
            open = true;
            active = moveActive(active, e.key === 'ArrowDown' ? 1 : -1, hits.length);
        } else if (e.key === 'Escape' && showing) {
            // first Esc closes the list; only a second one gets the search field's native clear
            e.preventDefault();
            open = false;
            active = -1;
        }
    }

    // Enter (or a phone keyboard's search key) follows the highlighted hit, else the top one.
    // Pressed before the answer is in, it searches now and goes when the answer lands.
    function onsubmit(e: SubmitEvent) {
        e.preventDefault();
        const term = q.trim();
        if (term.length < 2) return;
        if (answered === term) {
            const hit = hits[active] ?? hits[0];
            if (hit) window.location.href = hit.href;
            return;
        }
        clearTimeout(timer);
        goWhenAnswered = true;
        search(term);
    }

    function onfocusout(e: FocusEvent) {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) open = false;
    }
</script>

<form role="search" onsubmit={onsubmit} onfocusin={() => (open = true)} {onfocusout}>
    <!-- 16px text (no zoom on focus) and 50px tall in the phone menu, 34px on a desktop row.
         The utilities pin it on every page: base.css, which GenericPage loads and the
         scoreboard does not, strips a navbar input's border and re-pads it -->
    <input
        type="search"
        id="site-search-input"
        class="form-control border px-3 py-2 py-xl-0 lh-lg"
        size="16"
        role="combobox"
        aria-label="Search"
        aria-autocomplete="list"
        aria-controls="site-search-results"
        aria-expanded={showing}
        aria-activedescendant={showing && active >= 0 ? `site-search-option-${active}` : undefined}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        {placeholder}
        bind:value={q}
        {oninput}
        {onkeydown}
    />
    <!-- static in the phone nav (.navbar-nav .dropdown-menu), so the results push the
         links down instead of being clipped; mousedown keeps focus in the input, so a
         tap lands on the link before the list closes -->
    <div
        class="dropdown-menu dropdown-menu-end w-100"
        class:show={showing}
        id="site-search-results"
        role="listbox"
        aria-label="Search results"
        data-bs-popper="none"
        tabindex="-1"
        onmousedown={(e) => e.preventDefault()}
    >
        {#if !hits.length}
            <span class="dropdown-item-text text-muted">No results</span>
        {/if}
        {#each GROUPS as [type, name] (type)}
            {@const group = hits.filter((h) => h.type === type)}
            {#if group.length}
                <div role="group" aria-labelledby="site-search-group-{type}">
                    <h6 class="dropdown-header" id="site-search-group-{type}">{name}</h6>
                    {#each group as hit (hit.href)}
                        {@const i = hits.indexOf(hit)}
                        <a
                            class="dropdown-item text-wrap"
                            class:active={i === active}
                            href={hit.href}
                            id="site-search-option-{i}"
                            role="option"
                            aria-selected={i === active}
                        >
                            {hit.label}
                            {#if hit.sublabel}<span class="d-block small" class:text-muted={i !== active}>{hit.sublabel}</span>{/if}
                        </a>
                    {/each}
                </div>
            {/if}
        {/each}
    </div>
</form>
