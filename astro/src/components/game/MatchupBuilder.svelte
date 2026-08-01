<script lang="ts">
    import type { TeamIndex } from "../../utils/common";
    import { cleanName } from "../../utils/misc";

    const { teamSeasons, homeTeamId, homeSeason, awayTeamId, awaySeason } = $props();

    let selectedHomeTeamId = $state(homeTeamId || "59")
    let selectedHomeSeason = $state(homeSeason || "2025")
    let availableHomeTeamSeasons = $derived(teamSeasons.filter((t: TeamIndex) => String(t.team_id) == String(selectedHomeTeamId)).flatMap((t: TeamIndex) => t.seasons))

    function onChangeHomeTeam(e: Event) {
        const oldTeamId = selectedHomeTeamId;
        selectedHomeTeamId = e.target.value;
        if (oldTeamId != selectedHomeTeamId) {
            selectedHomeSeason = availableHomeTeamSeasons[0]
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
            selectedAwaySeason = availableAwayTeamSeasons[0]
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
                <div class="col-xs-12 col-md-auto text-center"><button class="btn btn-md btn-primary" disabled={!canGenerateMatchup} onclick={onSubmit}>Generate</button></div>
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
</div>
