<script>
    import { TEAM_METRIC_CATEGORIES, AVAILABLE_SEASONS } from "../../utils/constants";
    import { toTitleCase } from "../../utils/misc";

    const { season, category, metric, onChangeValue } = $props()

    function onChangeSeason(e) {
        onChangeValueWrapper(e.target.value, category, metric)
    }

    function onChangeCategory(e) {
        onChangeValueWrapper(season, e.target.value, metric)
    }

    function onChangeMetric(e) {
        onChangeValueWrapper(season, category, e.target.value)
    }

    function onChangeValueWrapper(s, c, m) {
		if (onChangeValue) {
            onChangeValue(s, c, m)
        } else {
            window.location = `/year/${s}/teams/${c}?sort=${m}`;
        }
    }

    let optGroupMap = {};
    for (const [c, metrics] of Object.entries(TEAM_METRIC_CATEGORIES)) {
        if (category != c) {
            continue;
        }
        for (const [key, title] of Object.entries(metrics)) {
            let splits = key.split(".")
            let subcat = splits[0]
            if (key == "overall.havocRate") {
                subcat = "other"
            }
            
            if (!Object.keys(optGroupMap).includes(subcat)) {
                optGroupMap[subcat] = []
            }
            optGroupMap[subcat].push([key, title])
        }
    }

</script>
<form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start" id="dropdown-form">
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
                <option value="differential" selected={(category == 'differential')}>Net</option>
                <option value="offensive" selected={(category == 'offensive')}>Offensive</option>
                <option value="defensive" selected={(category == 'defensive')}>Defensive</option>
            </select>
        </div>
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                {#each Object.entries(optGroupMap) as [subcat, metrics]}
                    <optgroup label={toTitleCase(subcat)}>
                        {#each metrics as m}
                            <option value={m[0]} selected={(metric == m[0])}>{m[1]}</option>
                        {/each}
                    </optgroup>
				{/each}
            </select>
        </div>
    </div>
</form>