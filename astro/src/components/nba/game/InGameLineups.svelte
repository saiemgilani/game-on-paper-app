<script lang="ts">
    // BB-G37, behind 'bball-ingame-lineups': one side's 1- to 5-man units (a size selector and the small-sample toggle),
    // each player's on/off, and the on/off picker. Server-rendered at its defaults (five-man units, small samples hidden),
    // so the tables are there without JavaScript; the picker needs it.
    import { allCombos, bigSample, COMBO_MAX, MIN_MINUTES, MIN_POSS, pickSplit, PICK_MAX, UNIT_SIZES, type InGameSide, type Split } from '../../../utils/inGameLineups';
    import { shortName } from '../../../utils/impactBox';
    let { side, abbr, id }: { side: InGameSide; abbr: string; id: string } = $props();

    const dash = '—';
    const signed = (v: number | null | undefined, d = 0) => (v == null ? dash : v > 0 ? `+${v.toFixed(d)}` : v < 0 ? `−${Math.abs(v).toFixed(d)}` : (0).toFixed(d));
    const dec = (v: number | null | undefined, d = 1) => (v == null ? dash : v.toFixed(d));
    const pct = (v: number | null | undefined) => (v == null ? dash : `${(v * 100).toFixed(1)}%`);

    let size = $state(5);
    let hideSmall = $state(true);
    const rows = $derived((side.units[size] ?? []).filter((u) => !hideSmall || bigSample(u)));
    const hidden = $derived((side.units[size] ?? []).length - rows.length);

    const maxSwing = $derived(Math.max(1, ...side.onOff.map((r) => Math.abs((r.plus_minus_on ?? 0) - (r.plus_minus_off ?? 0)))));

    let pick = $state<Record<string, 'on' | 'off'>>({});
    const chosen = $derived(Object.keys(pick));
    const set = (pid: string, v: 'on' | 'off' | null) => {
        const next = { ...pick };
        if (v === null) delete next[pid];
        else if (next[pid] || chosen.length < PICK_MAX) next[pid] = v;
        pick = next;
    };
    const nameOf = $derived(new Map((side.picker?.players ?? []).map((p) => [p.id, p.name])));
    const label = (ids: string[]) => ids.map((i) => shortName(nameOf.get(i) ?? i)).join(', ');
    const split = $derived(side.picker ? pickSplit(side.picker, chosen.filter((p) => pick[p] === 'on'), chosen.filter((p) => pick[p] === 'off')) : null);
    const combos = $derived(side.picker && chosen.length > 0 && chosen.length <= COMBO_MAX ? allCombos(side.picker, chosen) : []);
</script>

{#snippet splitCells(s: Split)}
    <td class="text-end">{dec(s.minutes)}</td>
    <td class="text-end">{s.poss}</td>
    <td class="text-end">{s.pts}–{s.opp_pts}</td>
    <td class="text-end fw-bold">{signed(s.plus_minus)}</td>
    <td class="text-end">{dec(s.off_rtg)}</td>
    <td class="text-end">{dec(s.def_rtg)}</td>
    <td class="text-end">{signed(s.net_rtg, 1)}</td>
{/snippet}

<div id={id} data-ingame>
    <h4 class="h6 mt-3">In-game units</h4>
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2 small">
        <div class="btn-group btn-group-sm" role="group" aria-label={`${abbr} unit size`}>
            {#each UNIT_SIZES as n (n)}
                <button type="button" class="btn btn-outline-secondary" class:active={size === n} aria-pressed={size === n} onclick={() => (size = n)}>{n}-man</button>
            {/each}
        </div>
        <label class="form-check-label d-flex align-items-center gap-1"><input type="checkbox" class="form-check-input mt-0" bind:checked={hideSmall} /> {MIN_MINUTES}+ min and {MIN_POSS}+ poss</label>
        {#if hidden > 0}<span class="text-muted">{hidden} smaller {hidden === 1 ? 'unit' : 'units'} hidden</span>{/if}
    </div>
    {#if rows.length === 0}
        <p class="text-muted small">No {size}-man units for {abbr}{hideSmall ? ' with that sample' : ''}.</p>
    {:else}
        <div class="table-responsive"><table class="table table-sm numeral align-middle" aria-label={`${abbr} ${size}-man units`}>
            <thead><tr>
                <th scope="col">Unit</th><th scope="col" class="text-end">MIN</th>
                <th scope="col" class="text-end"><abbr title="Possessions for / against">Poss</abbr></th>
                <th scope="col" class="text-end">Score</th><th scope="col" class="text-end">+/-</th>
                <th scope="col" class="text-end"><abbr title="Points scored per 100 possessions">ORtg</abbr></th>
                <th scope="col" class="text-end"><abbr title="Points allowed per 100 possessions">DRtg</abbr></th>
                <th scope="col" class="text-end">Net</th>
                <th scope="col" class="text-end"><abbr title="Effective FG%, for / against">eFG%</abbr></th>
                <th scope="col" class="text-end"><abbr title="Turnovers per possession, for / against">TO%</abbr></th>
                <th scope="col" class="text-end"><abbr title="Offensive / defensive rebound rate">OR% / DR%</abbr></th>
                <th scope="col" class="text-end"><abbr title="Share of field-goal attempts from three, for / against">3PA rate</abbr></th>
                <th scope="col" class="text-end"><abbr title="Share of field-goal attempts at the rim, for / against">Rim rate</abbr></th>
            </tr></thead>
            <tbody>
                {#each rows as u (u.lineup_id)}
                    <tr>
                        <th scope="row" class="fw-normal small">{u.names.map(shortName).join(', ')}</th>
                        <td class="text-end">{dec(u.minutes)}</td>
                        <td class="text-end text-nowrap">{u.poss} / {u.opp_poss}</td>
                        <td class="text-end text-nowrap">{u.pts}–{u.opp_pts}</td>
                        <td class="text-end fw-bold">{signed(u.plus_minus)}</td>
                        <td class="text-end">{dec(u.off_rtg)}</td>
                        <td class="text-end">{dec(u.def_rtg)}</td>
                        <td class="text-end">{signed(u.net_rtg, 1)}</td>
                        <td class="text-end text-nowrap">{pct(u.efg_pct)} / {pct(u.opp_efg_pct)}</td>
                        <td class="text-end text-nowrap">{pct(u.tov_pct)} / {pct(u.opp_tov_pct)}</td>
                        <td class="text-end text-nowrap">{pct(u.orb_pct)} / {pct(u.opp_orb_pct == null ? null : 1 - u.opp_orb_pct)}</td>
                        <td class="text-end text-nowrap">{pct(u.fg3_rate)} / {pct(u.opp_fg3_rate)}</td>
                        <td class="text-end text-nowrap">{pct(u.rim_rate)} / {pct(u.opp_rim_rate)}</td>
                    </tr>
                {/each}
            </tbody>
        </table></div>
    {/if}

    <h4 class="h6 mt-3">On/off</h4>
    {#if side.onOff.length === 0}
        <p class="text-muted small">No on/off rows for {abbr}.</p>
    {:else}
        <div class="table-responsive"><table class="table table-sm numeral align-middle" aria-label={`${abbr} on/off`}>
            <thead><tr>
                <th scope="col">Player</th><th scope="col" class="text-end">MIN on</th>
                <th scope="col" class="text-end"><abbr title="Team +/- with the player on / off the floor">+/- on / off</abbr></th>
                <th scope="col"><abbr title="On-court margin minus off-court margin">On − off</abbr></th>
                <th scope="col" class="text-end"><abbr title="Net rating on minus off, per 100 possessions">Net diff</abbr></th>
                <th scope="col" class="text-end"><abbr title="ORtg on minus off">ORtg diff</abbr></th>
                <th scope="col" class="text-end"><abbr title="DRtg on minus off (lower is better)">DRtg diff</abbr></th>
            </tr></thead>
            <tbody>
                {#each side.onOff as r (r.player_id)}
                    {@const swing = (r.plus_minus_on ?? 0) - (r.plus_minus_off ?? 0)}
                    <tr>
                        <th scope="row" class="fw-normal text-nowrap">{r.name}</th>
                        <td class="text-end">{dec(r.minutes_on)}</td>
                        <td class="text-end text-nowrap">{signed(r.plus_minus_on)} / {signed(r.plus_minus_off)}</td>
                        <td class="text-nowrap" style="min-width: 8rem">
                            <span class="d-inline-block align-middle" style={`height: .6rem; width: ${(48 * Math.abs(swing)) / maxSwing}%; margin-left: ${swing < 0 ? 50 - (48 * Math.abs(swing)) / maxSwing : 50}%; background: ${swing < 0 ? 'var(--bs-danger)' : 'var(--bs-success)'}`} aria-hidden="true"></span>
                            <span class="fw-bold ms-1">{signed(swing)}</span>
                        </td>
                        <td class="text-end">{signed(r.net_rtg_diff, 1)}</td>
                        <td class="text-end">{signed(r.off_rtg_diff, 1)}</td>
                        <td class="text-end">{signed(r.def_rtg_diff, 1)}</td>
                    </tr>
                {/each}
            </tbody>
        </table></div>
    {/if}

    {#if side.picker}
        <h4 class="h6 mt-3">On/off picker</h4>
        <p class="small text-muted mb-2">Mark up to {PICK_MAX} players ON or OFF to see {abbr}'s game in those minutes; with up to {COMBO_MAX} marked, every on/off combination is listed.</p>
        <div class="d-flex flex-wrap gap-2 mb-2 small">
            {#each side.picker.players as p (p.id)}
                <div class="btn-group btn-group-sm" role="group" aria-label={p.name}>
                    <span class="btn btn-outline-secondary disabled text-body">{shortName(p.name)}</span>
                    <button type="button" class="btn btn-outline-success" class:active={pick[p.id] === 'on'} aria-pressed={pick[p.id] === 'on'} disabled={!pick[p.id] && chosen.length >= PICK_MAX} onclick={() => set(p.id, pick[p.id] === 'on' ? null : 'on')}>On</button>
                    <button type="button" class="btn btn-outline-danger" class:active={pick[p.id] === 'off'} aria-pressed={pick[p.id] === 'off'} disabled={!pick[p.id] && chosen.length >= PICK_MAX} onclick={() => set(p.id, pick[p.id] === 'off' ? null : 'off')}>Off</button>
                </div>
            {/each}
            {#if chosen.length}<button type="button" class="btn btn-sm btn-link" onclick={() => (pick = {})}>Clear</button>{/if}
        </div>
        {#if split}
            <div class="table-responsive"><table class="table table-sm numeral align-middle" aria-label={`${abbr} on/off split`} aria-live="polite">
                <thead><tr><th scope="col">Split</th><th scope="col" class="text-end">MIN</th><th scope="col" class="text-end">Poss</th><th scope="col" class="text-end">Score</th><th scope="col" class="text-end">+/-</th><th scope="col" class="text-end">ORtg</th><th scope="col" class="text-end">DRtg</th><th scope="col" class="text-end">Net</th></tr></thead>
                <tbody>
                    {#if combos.length}
                        {#each combos as c (c.off.join('-') + '|' + c.on.join('-'))}
                            {@const mine = c.on.every((p) => pick[p] === 'on') && c.off.every((p) => pick[p] === 'off')}
                            <tr class:table-active={mine}>
                                <th scope="row" class="fw-normal small">{c.on.length ? `ON ${label(c.on)}` : ''}{c.on.length && c.off.length ? '; ' : ''}{c.off.length ? `OFF ${label(c.off)}` : ''}</th>
                                {@render splitCells(c.split)}
                            </tr>
                        {/each}
                    {:else}
                        <tr class="table-active">
                            <th scope="row" class="fw-normal small">{chosen.length ? 'Selection' : `${abbr}, whole game`}</th>
                            {@render splitCells(split)}
                        </tr>
                    {/if}
                </tbody>
            </table></div>
        {/if}
    {/if}
</div>
