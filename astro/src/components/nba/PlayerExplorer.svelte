<script lang="ts">
    // blazing-the-nets components/PlayerExplorer.tsx on Svelte 5 runes: the player's season,
    // filterable by game (presets, single games, a brushed or typed date window), with every
    // chart below rebuilt from the selected games. All state is client-side; the server sends
    // the shots, the games and the league context once.
    import { buildDashboard, type LeagueContext } from '../../nba/dashboard';
    import { rollingLines, shootingLine, type PlayerGame } from '../../nba/data/aggregate';
    import type { ShotLite } from '../../nba/data/shots';
    import { fmtDate, fmtInt, fmtPct } from '../../nba/format';
    import { GAME_PRESETS, PRESET_LABELS, presetGames, selectedView, withTypedDate, type DateWindow, type GamePreset } from '../../nba/selection';
    import Dashboard from './Dashboard.svelte';
    import GameStrip from './charts/GameStrip.svelte';
    import NbaPanel from './NbaPanel.svelte';
    import RollingChart from './charts/RollingChart.svelte';
    import Timeline from './charts/Timeline.svelte';
    import VersusChart from './charts/VersusChart.svelte';

    export interface ExplorerData { shots: ShotLite[]; games: PlayerGame[] | null; league: LeagueContext; seasonFgPct: number | null }
    let { data, subject }: { data: ExplorerData; subject: string } = $props();

    const WINDOWS = [5, 10, 20] as const;
    const NO_GAMES = 'No games selected: choose games above (a preset, single games or a date window) to draw this.';
    // svelte-ignore state_referenced_locally -- data is fixed for the island's life (one player-season per page)
    const games = data.games;
    let selected = $state<ReadonlySet<string>>(new Set(games?.map((g) => g.game_id) ?? []));
    let dateWindow = $state<DateWindow>(null);
    let n = $state<(typeof WINDOWS)[number]>(10);
    // what each date field shows while it has focus (Chromium reports half-typed values)
    let drafts = $state<[string | null, string | null]>([null, null]);

    const toggle = (gameId: string) => {
        const next = new Set(selected);
        if (next.has(gameId)) next.delete(gameId); else next.add(gameId);
        selected = next;
    };
    const choose = (preset: GamePreset) => { if (games) selected = new Set(presetGames(games, preset)); };
    const activePreset = $derived(games ? GAME_PRESETS.find((p) => { const ids = presetGames(games, p); return ids.length === selected.size && ids.every((id) => selected.has(id)); }) : undefined);
    const view = $derived(selectedView(data, selected, dateWindow));
    const dashboard = $derived(buildDashboard(view.shots, data.league));
    const rolling = $derived({ points: view.view ? rollingLines(view.view, n) : [], seasonFgPct: data.seasonFgPct, n });
    const line = $derived(shootingLine(view.shots));
    const neutral = games ? games.filter((g) => g.venue === 'neutral').length : 0;
    const empty = $derived(view.view !== null && view.view.length === 0);
    const first = games?.[0]?.date ?? '';
    const last = games?.[games.length - 1]?.date ?? '';
    const windowText = $derived(dateWindow ? `${fmtDate(dateWindow[0])} to ${fmtDate(dateWindow[1])}` : null);
    const caption = $derived(`${games && view.view ? `${view.view.length} of ${games.length} games${windowText ? `, ${windowText}` : ''}` : 'Every game'}; league lines: full regular season.`);
    const onDate = (end: 0 | 1, value: string) => {
        drafts = end === 0 ? [value, drafts[1]] : [drafts[0], value];
        dateWindow = withTypedDate(dateWindow, end, value, first, last);
    };
</script>

{#if games}
    <NbaPanel id="nba-games" title="Games">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3" role="group" aria-label="Select games">
            {#each GAME_PRESETS as p (p)}
                <button type="button" class="btn btn-sm btn-outline-secondary" class:active={activePreset === p} aria-pressed={activePreset === p} onclick={() => choose(p)}>{PRESET_LABELS[p]}</button>
            {/each}
            {#if neutral > 0}<span class="text-muted small">{neutral} neutral-site game{neutral === 1 ? '' : 's'} (in neither Home nor Away)</span>{/if}
        </div>
        <p class="mb-2 small numeral" aria-live="polite">
            {view.view?.length ?? 0} of {games.length} games{windowText ? ` · ${windowText}` : ''} · {fmtInt(line.makes)}/{fmtInt(line.attempts)} FG, {fmtPct(line.fgPct)} FG%, {fmtPct(line.efgPct)} eFG%
        </p>
        <GameStrip data={{ games, seasonFgPct: data.seasonFgPct }} {selected} window={dateWindow} onToggle={toggle} title={`${subject} games`} />
        <div class="d-flex flex-wrap align-items-center gap-3 mt-3 mb-1">
            <p class="small text-muted mb-0">Drag across the timeline, or set the dates, to limit the charts to a date window.</p>
            <div class="d-flex flex-wrap align-items-center gap-2" role="group" aria-label="Date window">
                <label class="small text-muted d-flex align-items-center gap-1">From
                    <input type="date" class="form-control form-control-sm" min={first} max={last} value={drafts[0] ?? dateWindow?.[0] ?? ''} oninput={(e) => onDate(0, e.currentTarget.value)} onblur={() => (drafts = [null, drafts[1]])} />
                </label>
                <label class="small text-muted d-flex align-items-center gap-1">To
                    <input type="date" class="form-control form-control-sm" min={first} max={last} value={drafts[1] ?? dateWindow?.[1] ?? ''} oninput={(e) => onDate(1, e.currentTarget.value)} onblur={() => (drafts = [drafts[0], null])} />
                </label>
                {#if dateWindow}<button type="button" class="btn btn-sm btn-outline-secondary" onclick={() => (dateWindow = null)}>Clear dates</button>{/if}
            </div>
        </div>
        <Timeline {games} window={dateWindow} onBrush={(w) => (dateWindow = w)} title={`${subject} game timeline (attempts per game)`} />
    </NbaPanel>
{:else}
    <p class="alert alert-secondary small">Game-by-game views are unavailable for this season: the game logs do not cover every game this player shot in.</p>
{/if}

<div id="charts" class="mb-3">
    <p class="small text-muted numeral">{caption}</p>
    {#if empty}<p class="alert alert-secondary small">{NO_GAMES}</p>{:else}<Dashboard data={dashboard} {subject} />{/if}
</div>

{#if games}
    <NbaPanel id="nba-rolling" title="Rolling shooting">
        <div class="d-flex align-items-center gap-2 mb-3 text-muted small" role="group" aria-label="Rolling window">
            Window
            {#each WINDOWS as w (w)}
                <button type="button" class="btn btn-sm btn-outline-secondary" class:active={n === w} aria-pressed={n === w} onclick={() => (n = w)}>{w} games</button>
            {/each}
        </div>
        {#if empty}<p class="small text-muted">{NO_GAMES}</p>{:else}<RollingChart data={rolling} title={`${subject} rolling ${n}-game FG% and eFG%`} />{/if}
    </NbaPanel>
{/if}

{#if view.versus}
    <NbaPanel id="nba-versus" title="Versus each opponent">
        {#if empty}<p class="small text-muted">{NO_GAMES}</p>{:else}<VersusChart data={view.versus} title={`${subject} attempts and FG% against each opponent`} />{/if}
    </NbaPanel>
{/if}
