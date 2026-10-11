<!-- src/components/nba/Leaderboards.svelte -->
<script lang="ts">
    // blazing-the-nets' Leaderboards.tsx on runes: pick the window and the board; the Nets are
    // highlighted, shown below the top rows and the rest behind a <details>.
    import { ACTIVE_DAYS, LEADER_LABELS, LEADER_METRICS, LEADER_WINDOWS, minAttempts, minThrees, type Boards, type LeaderMetric, type LeaderRow, type LeaderWindow } from '../../nba/data/leaders';
    import { fmtDate, fmtInt, fmtPct, fmtPts } from '../../nba/format';
    import { playerHref } from '../../nba/links';
    let { boards, netsTeamId, seasonQuery }: { boards: Boards; netsTeamId: number; seasonQuery: string } = $props();
    /** Nets rows shown below the top 15; the rest sit in a <details>. */
    const NETS_SHOWN = 5;
    let n = $state<LeaderWindow>(10);
    let metric = $state<LeaderMetric>('efgPct');
    const board = $derived(boards[n][metric]);
    const value = (r: LeaderRow) => (metric === 'improved' ? `${fmtPts(r.value)} pts` : fmtPct(r.value));
    const detail = (r: LeaderRow) => (metric === 'fg3Pct' ? `${r.window.fg3m}/${r.window.fg3a} 3P` : `${fmtInt(r.window.makes)}/${fmtInt(r.window.attempts)} FG`);
    const nets = $derived(board.also.slice(0, NETS_SHOWN));
    const moreNets = $derived(board.also.slice(NETS_SHOWN));
</script>

{#snippet row(r: LeaderRow)}
    <tr class:fw-bold={r.team_id === netsTeamId}>
        <td class="numeral">{r.rank}</td>
        <td class="text-truncate">
            <a href={playerHref(r.person_id, seasonQuery)}>{r.name}</a>
            <span class="d-block d-md-none small fw-normal text-muted">last game {fmtDate(r.window.to)}</span>
        </td>
        <td class="text-muted">{r.team}</td>
        <td class="text-end numeral">{value(r)}</td>
        <td class="text-end numeral d-none d-sm-table-cell">{detail(r)}</td>
        {#if metric === 'improved'}<td class="text-end numeral d-none d-sm-table-cell">{fmtPct(r.seasonEfg)}</td>{/if}
        <td class="text-end numeral text-muted d-none d-md-table-cell">{fmtDate(r.window.from)} to {fmtDate(r.window.to)}</td>
    </tr>
{/snippet}

<div class="d-flex flex-wrap align-items-center gap-2 mb-2" role="group" aria-label="Window">
    <span class="small text-muted">Last</span>
    {#each LEADER_WINDOWS as w (w)}
        <button type="button" class="btn btn-sm btn-outline-secondary" class:active={n === w} aria-pressed={n === w} onclick={() => (n = w)}>{w} games</button>
    {/each}
</div>
<div class="d-flex flex-wrap gap-2 mb-2" role="group" aria-label="Board">
    {#each LEADER_METRICS as m (m)}
        <button type="button" class="btn btn-sm btn-outline-secondary" class:active={metric === m} aria-pressed={metric === m} onclick={() => (metric = m)}>{LEADER_LABELS[m]}</button>
    {/each}
</div>
<p class="small text-muted">
    Each player's last {n} games with a field-goal attempt (a full {n}-game window), {minAttempts(n)}+ FGA in it{metric === 'fg3Pct' ? ` and ${minThrees(n)}+ threes` : ''}.
    {metric === 'improved' ? 'Most improved: window eFG% minus his season eFG%. ' : ''}
    Active shooters only: last game within {ACTIVE_DAYS} days of the season's latest game. {board.eligible} players qualify.
</p>
<div class="table-responsive">
    <table class="table table-sm" id="nba-leaders">
        <thead>
            <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col">Team</th>
                <th scope="col" class="text-end">{LEADER_LABELS[metric]}</th>
                <th scope="col" class="text-end d-none d-sm-table-cell">{metric === 'fg3Pct' ? '3PM/3PA' : 'FGM/FGA'}</th>
                {#if metric === 'improved'}<th scope="col" class="text-end d-none d-sm-table-cell">Season eFG%</th>{/if}
                <th scope="col" class="text-end d-none d-md-table-cell">Window</th>
            </tr>
        </thead>
        <tbody>
            {#each board.rows as r (r.person_id)}{@render row(r)}{/each}
        </tbody>
        {#if nets.length > 0}
            <tbody>
                <tr><th scope="rowgroup" colspan={metric === 'improved' ? 7 : 6} class="small fw-normal text-muted pt-3">Nets further down</th></tr>
                {#each nets as r (r.person_id)}{@render row(r)}{/each}
            </tbody>
        {/if}
    </table>
</div>
{#if moreNets.length > 0}
    <details>
        <summary class="small">{moreNets.length} more Nets</summary>
        <div class="table-responsive">
            <table class="table table-sm mt-1"><tbody>{#each moreNets as r (r.person_id)}{@render row(r)}{/each}</tbody></table>
        </div>
    </details>
{/if}
