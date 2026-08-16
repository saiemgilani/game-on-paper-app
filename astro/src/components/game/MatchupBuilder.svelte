<script lang="ts">
    import type { TeamIndex } from "../../utils/teams";
    import { cleanName, roundNumber, cleanField } from "../../utils/misc";

    const { teamSeasons, homeTeamId, homeSeason, awayTeamId, awaySeason, projection } = $props();

    let selectedHomeTeamId = $state(homeTeamId || "59")
    let selectedHomeSeason = $state(homeSeason || "2025")
    let availableHomeTeamSeasons = $derived(teamSeasons.filter((t: TeamIndex) => String(t.team_id) == String(selectedHomeTeamId)).flatMap((t: TeamIndex) => t.seasons))

    function onChangeHomeTeam(e: Event) {
        const oldTeamId = selectedHomeTeamId;
        selectedHomeTeamId = e.target.value;
        if (oldTeamId != selectedHomeTeamId) {
            selectedHomeSeason = Math.max(...availableHomeTeamSeasons)
        }
    }

    function onChangeHomeSeason(e: Event) {
        selectedHomeSeason = e.target.value;
    }


    let selectedAwayTeamId = $state(awayTeamId || "52")
    let selectedAwaySeason = $state(awaySeason || "2025")
    let availableAwayTeamSeasons = $derived(teamSeasons.filter((t: TeamIndex) => String(t.team_id) == String(selectedAwayTeamId)).flatMap((t: TeamIndex) => t.seasons))

    function onChangeAwayTeam(e: Event) {
        const oldTeamId = selectedAwayTeamId;
        selectedAwayTeamId = e.target.value;
        if (oldTeamId != selectedAwayTeamId) {
            selectedAwaySeason = Math.max(...availableAwayTeamSeasons)
        }
    }

    function onChangeAwaySeason(e: Event) {
        selectedAwaySeason = e.target.value;
    }

    let canGenerateMatchup = $derived(selectedAwaySeason && selectedAwayTeamId && selectedHomeTeamId && selectedHomeSeason)

    function onSubmit(e: Event) {
        e.preventDefault()
        const urlParams = new URLSearchParams({
            "awaySeason": selectedAwaySeason,
            "awayTeamId": selectedAwayTeamId,
            "homeSeason": selectedHomeSeason,
            "homeTeamId": selectedHomeTeamId
        })
        window.location = `/game/matchup?${urlParams.toString()}`
    }
</script>
<div class="container">
    <div class="row">
        <div class="col-12">
            <div class="mb-3 d-flex justify-content-center">
                <div class="col-xs-12 col-md-auto me-3">
                    <select class="form-select form-select-md mb-2" onchange={onChangeAwayTeam}>
                        <option value="-1" disabled>Team...</option>
                        {#each teamSeasons as s}
                            <option value={s.team_id} selected={(String(selectedAwayTeamId) == String(s.team_id))}>{cleanName(s)}</option>
                        {/each}
                    </select>
                    <select class="form-select form-select-md" onchange={onChangeAwaySeason}>
                        <option value="-1" disabled>Season...</option>
                        {#each availableAwayTeamSeasons as s}
                            <option value={s} selected={(String(selectedAwaySeason) == String(s))}>{s}</option>
                        {/each}
                    </select>
                </div>
                <div class="col-xs-12 col-md-auto text-center">
                    <button class="btn btn-md btn-primary" disabled={!canGenerateMatchup} onclick={onSubmit}>Generate</button>
                </div>
                <div class="col-xs-12 col-md-auto ms-3">
                    <select class="form-select form-select-md mb-2" onchange={onChangeHomeTeam}>
                        <option value="-1" disabled>Team...</option>
                        {#each teamSeasons as s}
                            <option value={s.team_id} selected={(String(selectedHomeTeamId) == String(s.team_id))}>{cleanName(s)}</option>
                        {/each}
                    </select>
                    <select class="form-select form-select-md" onchange={onChangeHomeSeason}>
                        <option value="-1" disabled>Season...</option>
                        {#each availableHomeTeamSeasons as s}
                            <option value={s} selected={(String(selectedHomeSeason) == String(s))}>{s}</option>
                        {/each}
                    </select>
                </div>
            </div>
        </div>
    </div>
    {#if projection}
    <div class="row mt-2">
        <div class="col-12 text-center">
            <p class="mb-0 fs-2"><strong>Projected Winner: <a href={`/team/${projection.team_id}`}><img class={`img-fluid team-logo-${projection.team_id} me-1 align-middle`} width="50px" src={`https://a.espncdn.com/i/teamlogos/ncaa/500/${projection.team_id}.png`} alt={`ESPN team id ${projection.team_id}`}/></a>{cleanField(projection, "winner")}</strong></p>
            <p title="Based on the two teams' Net Adj EPA/Play at a neutral site. This projection is for fun -- please don't use this for anything important.">by {roundNumber(projection.margin, 2, 1)} pts ({roundNumber(projection.win_prob * 100, 2, 1)}%) on a neutral site</p>
            {#if projection.actual_game_id}
            <div class="d-flex justify-content-center">
                <div class="w-auto">
                    <div class="alert alert-primary" role="alert" style="background: #031633; border: 1px solid #084298;">
                    We found a game for this matchup! <a href={`/game/${projection.actual_game_id}`}>Check out what actually happened.</a>
                    </div>
                </div>
            </div>
            {/if}
        </div>
    </div>
    {/if}
</div>
