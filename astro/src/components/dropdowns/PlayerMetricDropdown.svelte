<script>
    import { toTitleCase } from "../../utils/misc";
    import { SDV_PLAYER_METRIC_CATEGORIES } from "../../utils/constants";
    import { LEAGUES, leaguePath } from "../../utils/league";

    // `league` is passed by the SSR page (Astro.locals.league); cfb default
    // keeps every existing caller unchanged. `allTime` offers the all-time board
    // (the 'all-time-leaderboards' flag, read by the page); a null season is that board.
    const { season, category, metric, league = 'cfb', allTime = false } = $props()
    const seasons = LEAGUES[league].seasons;
    const ALL_TIME = 'all-time';

    function onChangeSeason(e) {
        onChangeValue(e.target.value, category, metric)
    }

    function onChangeCategory(e) {
        onChangeValue(season, e.target.value, metric)
    }

    function onChangeMetric(e) {
        onChangeValue(season, category, e.target.value)
    }

    function onChangeValue(s, c, m) {
		window.location = leaguePath(league, (s === ALL_TIME || s === null) ? `/all-time/players/${c}?sort=${m}` : `/year/${s}/players/${c}?sort=${m}`);
    }

</script>
<form class="mb-0 mb-sm-3 d-flex justify-content-xs-start justify-content-md-end">
    <div class="row flex-lg-nowrap">
        <div class="col-lg-auto mb-3">
            <select class="form-select form-select-md" onchange={onChangeSeason}>
				<option value="-1" disabled>Choose Season...</option>
				{#if allTime}
					<option value={ALL_TIME} selected={season == null}>All-time</option>
				{/if}
				{#each seasons as s}
					<option value={s} selected={(season == s)}>{s}</option>
				{/each}
            </select>
        </div>
        <div class="col-auto mb-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeCategory}>
                <option value="-1" disabled>Choose Category...</option>
                {#each Object.keys(SDV_PLAYER_METRIC_CATEGORIES) as s}
					<option value={s} selected={(category == s)}>{toTitleCase(s)}</option>
				{/each}
            </select>
        </div>
        <div class="col-auto mb-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                {#each Object.entries(SDV_PLAYER_METRIC_CATEGORIES) as [c, metrics]}
					{#if category == c}
                    <optgroup label={toTitleCase(c)}>
                        {#each Object.entries(metrics) as [key, m]}
                            <option value={key} selected={(metric == key)}>{m.title}</option>
                        {/each}
                    </optgroup>
                    {/if}
				{/each}
            </select>
        </div>
    </div>
</form>