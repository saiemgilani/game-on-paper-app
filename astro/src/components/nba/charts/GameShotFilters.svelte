<script lang="ts">
    // BB-G38 ('bball-shot-filters'): one filter bar over both teams' shot charts, the state kept in the URL (`?shot_*=`, the
    // server renders the asked filters first). With the league curve (BB-G39) each team's chart, signature and distance bars (Share / FG%)
    // share a `data-shot-link` dashboard. The signature and bars follow the team and shooter menus only (#451 Q4: a zone, period or
    // type cut leaves too few shots to set against the league curve): a chosen player's are his whole game, a team's its whole game.
    import ChartSvg from './ChartSvg.svelte';
    import ShootingSignature from './ShootingSignature.svelte';
    import DistanceBarsToggle from './DistanceBarsToggle.svelte';
    import type { Draw } from '../chartFrame';
    import type { Court } from '../../../basketball/config';
    import { COURT } from '../../../nba/data/court';
    import { describeShots, gameShotsLite, GAME_SHOT_VIEWBOX, renderGameShotChart } from '../../../nba/charts/gameShotChart';
    import { distanceCharts, type LeagueContext } from '../../../nba/dashboard';
    import type { PlaceholderLocation } from '../../../nba/data/placeholder';
    import type { GameStints } from '../../../resources/gameStints';
    import { isFiltered, matches, NO_FILTERS, shotLine, withFilters, type FilterShot, type ShotFilters } from '../../../basketball/shotFilters';

    type Option = { value: string; label: string };
    type Player = { id: string; name: string };
    type Side = { key: 'away' | 'home'; abbr: string; name: string; shots: FilterShot[]; players: Player[] };
    let { sides, periods, zones, kinds, moves = [], withPlayers = [], stints = null, league = null, placeholder = null, gameId, caption = '', initial = NO_FILTERS, court = COURT }: {
        sides: Side[]; periods: Option[]; zones: Option[]; kinds: Option[]
        /** the pros' shot moves (driving, pull-up, ...); empty in college */
        moves?: Option[]
        /** the ON/OFF menu: each side's players with stints; empty without stints (a live game, a season before them) */
        withPlayers?: { key: 'away' | 'home'; abbr: string; players: Player[] }[]; stints?: GameStints | null
        /** BB-G39's league curve; null: the charts alone */
        league?: Pick<LeagueContext, 'byFoot' | 'byBin'> | null; placeholder?: PlaceholderLocation | null; gameId: string; caption?: string
        initial?: ShotFilters; court?: Court
    } = $props();

    const f: ShotFilters = $state({ ...initial });
    const allPlayers = $derived(sides.flatMap((s) => s.players));
    const nameOf = (id: string) => allPlayers.find((p) => p.id === id)?.name ?? '';
    // a chosen player shows his team's chart alone
    const visible = $derived(sides.filter((s) => (!f.team || s.key === f.team) && (!f.player || s.players.some((p) => p.id === f.player))));
    const shown = $derived(new Map(sides.map((s) => [s.key, s.shots.filter((x) => matches(x, f, stints))])));
    // the menu's own value, not f.team: the handler need not run after the binding
    const pickTeam = (team: string) => { if (team && f.player && !sides.find((s) => s.key === team)?.players.some((p) => p.id === f.player)) f.player = ''; };
    const clear = () => Object.assign(f, NO_FILTERS);

    $effect(() => {
        const next = withFilters(new URL(location.href), f);
        // a refused update (rate-limited replaceState) costs only the reload memory, never the charts
        if (next.href !== location.href) try { history.replaceState(history.state, '', next); } catch { /* the charts still follow */ }
    });

    const drawFor = (shots: FilterShot[]): Draw => { const c = court; return (svg, width) => renderGameShotChart(svg, shots, { width, court: c }); };
    const distanceFor = (shots: FilterShot[]) => {
        if (!league) return null;
        const located = gameShotsLite(shots, gameId, placeholder);
        return located.length > 0 ? distanceCharts(located, league) : null;
    };
</script>

<div class="d-flex flex-wrap gap-2 align-items-center mb-2" role="group" aria-label="Shot filters" data-shot-filters>
    <select class="form-select form-select-sm w-auto" aria-label="Team" bind:value={f.team} onchange={(e) => pickTeam(e.currentTarget.value)}>
        <option value="">Both teams</option>
        {#each sides as s (s.key)}<option value={s.key}>{s.abbr}</option>{/each}
    </select>
    <select class="form-select form-select-sm w-auto" aria-label="Shooter" bind:value={f.player}>
        <option value="">All shooters</option>
        {#each sides.filter((s) => !f.team || s.key === f.team) as s (s.key)}
            <optgroup label={s.abbr}>{#each s.players as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</optgroup>
        {/each}
    </select>
    <select class="form-select form-select-sm w-auto" aria-label="Period" bind:value={f.period}>
        <option value="">All periods</option>
        {#each periods as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
    </select>
    <select class="form-select form-select-sm w-auto" aria-label="Result" bind:value={f.result}>
        <option value="">Made and missed</option><option value="made">Made</option><option value="missed">Missed</option>
    </select>
    {#if zones.length > 0}
        <select class="form-select form-select-sm w-auto" aria-label="Zone" bind:value={f.zone}>
            <option value="">All zones</option>
            {#each zones as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
        </select>
    {/if}
    {#if kinds.length > 0}
        <select class="form-select form-select-sm w-auto" aria-label="Shot type" bind:value={f.kind}>
            <option value="">All shot types</option>
            {#each kinds as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
        </select>
    {/if}
    {#if moves.length > 0}
        <select class="form-select form-select-sm w-auto" aria-label="Shot move" bind:value={f.move}>
            <option value="">All moves</option>
            {#each moves as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
        </select>
    {/if}
    <select class="form-select form-select-sm w-auto" aria-label="Assisted" bind:value={f.assist}>
        <option value="">Assisted or not</option><option value="ast">Assisted makes</option><option value="unast">Unassisted makes</option>
    </select>
    {#if withPlayers.length > 0}
        <span class="d-inline-flex gap-1">
            <select class="form-select form-select-sm w-auto" aria-label="On or off the floor" bind:value={f.withMode}>
                <option value="on">With</option><option value="off">Without</option>
            </select>
            <select class="form-select form-select-sm w-auto" aria-label="Player on or off the floor" bind:value={f.with}>
                <option value="">anyone on the floor</option>
                {#each withPlayers as s (s.key)}
                    <optgroup label={s.abbr}>{#each s.players as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</optgroup>
                {/each}
            </select>
        </span>
    {/if}
    {#if isFiltered(f)}<button type="button" class="btn btn-sm btn-outline-secondary" onclick={clear}>Clear</button>{/if}
</div>
<div class="row">
    {#each visible as s (s.key)}
        {@const xs = shown.get(s.key) ?? []}
        {@const line = shotLine(xs)}
        {@const who = f.player ? nameOf(f.player) : s.name}
        {@const d = distanceFor(f.player ? s.shots.filter((x) => x.shooter === f.player) : s.shots)}
        <div class="col-12 col-lg-6">
            <h3 class="h6">{f.player ? `${s.abbr}: ${nameOf(f.player)}` : s.abbr}</h3>
            <p class="small mb-2" aria-live="polite">{line || (s.shots.length ? 'No shots match these filters.' : 'No field goal attempts.')}</p>
            {#if league}
                <div data-shot-link>
                    <ChartSvg draw={drawFor(xs)} viewBox={GAME_SHOT_VIEWBOX} title={`${who} shots`} desc={describeShots(xs, court)} />
                    {#if d}
                        <h4 class="h6 small text-muted mt-2">Shooting signature</h4><ShootingSignature data={d.signature} title={`${who} FG% by distance vs league`} />
                        <DistanceBarsToggle data={d.bars} team={who} subjectLabel={f.player ? who : s.abbr} />
                        <p class="small text-muted mb-3">{caption}</p>
                    {/if}
                </div>
            {:else}
                <ChartSvg draw={drawFor(xs)} viewBox={GAME_SHOT_VIEWBOX} title={`${who} shots`} desc={describeShots(xs, court)} />
                <!-- the svg desc already reads this to screen readers -->
                <p class="small text-muted mb-3" aria-hidden="true">{describeShots(xs, court)}</p>
            {/if}
        </div>
    {/each}
</div>
