<script>
    import { toTitleCase } from "../../utils/misc";
    import { PLAYER_METRIC_CATEGORIES, AVAILABLE_SEASONS } from "../../utils/constants";

    const { season, category, metric } = $props()

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
		window.location = `/cfb/year/${s}/players/${c}?sort=${m}`;
    }

</script>
<form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start">
    <div class="row">
        <div class="col-lg-auto mb-3">
            <select class="form-select form-select-md" onchange={onChangeSeason}>
				<option value="-1" disabled>Choose Season...</option>
				{#each AVAILABLE_SEASONS as s}
					<option value={s} selected={(season == s)}>{s}</option>
				{/each}
            </select>
        </div>
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeCategory}>
                <option value="-1" disabled>Choose Category...</option>
                {#each Object.keys(PLAYER_METRIC_CATEGORIES) as s}
					<option value={s} selected={(category == s)}>{toTitleCase(s)}</option>
				{/each}
            </select>
        </div>
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                {#each Object.entries(PLAYER_METRIC_CATEGORIES) as [c, metrics]}
					{#if category == c}
                    <optgroup label={toTitleCase(c)}>
                        {#each Object.entries(metrics) as [key, title]}
                            <option value={key} selected={(metric == key)}>{title}</option>
                        {/each}
                    </optgroup>
                    {/if}
				{/each}
            </select>
        </div>
    </div>
</form>