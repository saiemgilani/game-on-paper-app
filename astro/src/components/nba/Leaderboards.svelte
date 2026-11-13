<!-- src/components/nba/Leaderboards.svelte -->
<script lang="ts">
    // blazing-the-nets' Leaderboards.tsx on runes: pick the window and the board; a featured team (the NBA's Nets) is
    // highlighted, shown below the top rows and the rest behind a <details>; with none (netsTeamId null) those parts never render.
    import { ACTIVE_DAYS, LEADER_LABELS, LEADER_METRICS, LEADER_WINDOWS, minAttempts, MOVER_METRIC, MOVER_MIN_SEASON_FGA, minThrees, NBA_LEADER_BARS, type Boards, type LeaderBars, type LeaderMetric, type LeaderRow, type LeaderWindow } from '../../nba/data/leaders';
    import { fmtDate, fmtInt, fmtPct, fmtPts } from '../../nba/format';
    import { playerHref } from '../../nba/hrefs';
    import type { BasketballLeague } from '../../utils/league';
    let { boards, netsTeamId, seasonQuery, pronoun = 'his', bars = NBA_LEADER_BARS, league = 'nba', windows = LEADER_WINDOWS, windowNote = '', activeByTeam = false, movers = false, metric = $bindable('efgPct'), boardButtons = true }: { boards: Boards; netsTeamId: number | null; seasonQuery: string; pronoun?: 'his' | 'her'; bars?: LeaderBars; league?: BasketballLeague; windows?: readonly LeaderWindow[]; windowNote?: string; activeByTeam?: boolean; movers?: boolean; metric?: LeaderMetric; boardButtons?: boolean } = $props();
    /** Nets rows shown below the top 15; the rest sit in a <details>. */
    const NETS_SHOWN = 5;
    let n = $state<LeaderWindow>(10);
    // BB-G11: with movers the boards carry "declined" (the route builds it only then)
    const metrics: readonly LeaderMetric[] = $derived(movers ? [...LEADER_METRICS, MOVER_METRIC] : LEADER_METRICS);
    const board = $derived(boards[n][metric]!);
    /** A board ranked on the change (window eFG% minus season eFG%) rather than a rate. */
    const change = $derived(metric === 'improved' || metric === 'declined');
    const value = (r: LeaderRow) => (change ? `${fmtPts(r.value)} pts` : fmtPct(r.value));
    const valueHead = $derived(metric === 'improved' ? 'eFG% gain' : metric === 'declined' ? 'eFG% change' : LEADER_LABELS[metric]);
    const detail = (r: LeaderRow) => (metric === 'fg3Pct' ? `${r.window.fg3m}/${r.window.fg3a} 3P` : `${fmtInt(r.window.makes)}/${fmtInt(r.window.attempts)} FG`);
    const nets = $derived(board.also.slice(0, NETS_SHOWN));
    const moreNets = $derived(board.also.slice(NETS_SHOWN));
</script>

{#snippet row(r: LeaderRow)}
    <tr class:fw-bold={r.team_id === netsTeamId}>
        <td class="numeral">{r.rank}</td>
        <td class="text-truncate">
            <a href={playerHref(r.person_id, seasonQuery, league)}>{r.name}</a>
            <span class="d-block d-md-none small fw-normal text-muted">last game {fmtDate(r.window.to)}</span>
        </td>
        <td class="text-muted">{r.team}</td>
        <td class="text-end numeral">{value(r)}</td>
        <td class="text-end numeral d-none d-sm-table-cell">{detail(r)}</td>
        {#if change}<td class="text-end numeral d-none d-sm-table-cell">{fmtPct(r.seasonEfg)}</td>{/if}
        <td class="text-end numeral text-muted d-none d-md-table-cell">{fmtDate(r.window.from)} to {fmtDate(r.window.to)}</td>
    </tr>
{/snippet}

<div class="d-flex flex-wrap align-items-center gap-2 mb-2" role="group" aria-label="Window">
    <span class="small text-muted">Last</span>
    {#each windows as w (w)}
        <button type="button" class="btn btn-sm btn-outline-secondary" class:active={n === w} aria-pressed={n === w} onclick={() => (n = w)}>{w} games</button>
    {/each}
</div>
<!-- with a picker outside (BoardSelectLeaderboards.svelte) the button row is hidden: a class swap, not a block, so the
     four-board page's markup stays byte for byte -->
<div class={boardButtons ? 'd-flex flex-wrap gap-2 mb-2' : 'd-none'} role="group" aria-label="Board">
    {#each metrics as m (m)}
        <button type="button" class="btn btn-sm btn-outline-secondary" class:active={metric === m} aria-pressed={metric === m} onclick={() => (metric = m)}>{LEADER_LABELS[m]}</button>
    {/each}
</div>
<p class="small text-muted">
    Each player's last {n} games with a field-goal attempt (a full {n}-game window), {minAttempts(n, bars)}+ FGA in it{metric === 'fg3Pct' ? ` and ${minThrees(n, bars)}+ threes` : ''}.
    {movers
        ? `The change: the window's eFG% minus ${pronoun} season eFG% to date (the window's games included), for players with ${MOVER_MIN_SEASON_FGA}+ FGA on the season. Most improved lists only rises and Most declined only drops, the largest first. `
        : metric === 'improved' ? `Most improved: window eFG% minus ${pronoun} season eFG%. ` : ''}
    Active shooters only: last game within {ACTIVE_DAYS} days of {activeByTeam ? `${pronoun} team's` : "the season's"} latest game. {board.eligible} players qualify.{windowNote}
</p>
<div class="table-responsive">
    <table class="table table-sm" id="nba-leaders">
        <caption class="visually-hidden">{LEADER_LABELS[metric]}, last {n} games</caption>
        <thead>
            <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col">Team</th>
                <th scope="col" class="text-end">{valueHead}</th>
                <th scope="col" class="text-end d-none d-sm-table-cell">{metric === 'fg3Pct' ? '3PM/3PA' : 'FGM/FGA'}</th>
                {#if change}<th scope="col" class="text-end d-none d-sm-table-cell">Season eFG%</th>{/if}
                <th scope="col" class="text-end d-none d-md-table-cell">Window</th>
            </tr>
        </thead>
        <tbody>
            {#each board.rows as r (r.person_id)}{@render row(r)}{/each}
        </tbody>
        {#if nets.length > 0}
            <tbody>
                <tr><th scope="rowgroup" colspan={change ? 7 : 6} class="small fw-normal text-muted pt-3">Nets further down</th></tr>
                {#each nets as r (r.person_id)}{@render row(r)}{/each}
            </tbody>
        {/if}
    </table>
</div>
{#if moreNets.length > 0}
    <details>
        <summary class="small">{moreNets.length} more Nets</summary>
        <div class="table-responsive">
            <table class="table table-sm mt-1">
                <caption class="visually-hidden">More Nets: {LEADER_LABELS[metric]}, last {n} games</caption>
                <thead class="visually-hidden">
                    <tr>
                        <th scope="col">#</th><th scope="col">Player</th><th scope="col">Team</th>
                        <th scope="col">{valueHead}</th>
                        <th scope="col">{metric === 'fg3Pct' ? '3PM/3PA' : 'FGM/FGA'}</th>
                        {#if change}<th scope="col">Season eFG%</th>{/if}
                        <th scope="col">Window</th>
                    </tr>
                </thead>
                <tbody>{#each moreNets as r (r.person_id)}{@render row(r)}{/each}</tbody>
            </table>
        </div>
    </details>
{/if}
