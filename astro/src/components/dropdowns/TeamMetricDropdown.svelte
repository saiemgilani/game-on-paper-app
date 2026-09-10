<script>
    import { SDV_TEAM_METRIC_CATEGORIES } from "../../utils/constants";
    import { toTitleCase, modifyMetricForCategory } from "../../utils/misc";
    import { LEAGUES, leaguePath, teamCategoriesFor } from "../../utils/league";

    // `league` is passed by the SSR page (Astro.locals.league); cfb default
    // keeps every existing caller unchanged.
    const { season, category, metric, onChangeValue, league = 'cfb' } = $props()
    const seasons = LEAGUES[league].seasons;
    // the shared three plus this league's extras (rbsdm-style nfl categories)
    const extraCategories = teamCategoriesFor(league).filter((c) => !['differential', 'offensive', 'defensive'].includes(c));

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
        m = modifyMetricForCategory(c, m)

		if (onChangeValue) {
            onChangeValue(s, c, m)
        } else {
            window.location = leaguePath(league, `/year/${s}/teams/${c}?sort=${m}`);
        }
    }

    let optGroupMap = {};
    for (const [c, metrics] of Object.entries(SDV_TEAM_METRIC_CATEGORIES)) {
        if (category != c) {
            continue;
        }
        for (const [key, title] of Object.entries(metrics)) {
            let subcat = "other"
            if (key.includes("_pass")) {
                subcat = "passing"
            } else if (key.includes("_rush")) {
                subcat = "rushing"
            } else if (key == "havoc_off" || key == "havoc_def") {
                subcat = "other"
            } else if (key.includes("_off") || key.includes("_def")) {
                subcat = "overall"
            }

            if (!Object.keys(optGroupMap).includes(subcat)) {
                optGroupMap[subcat] = []
            }
            optGroupMap[subcat].push([key, title])
        }
    }

</script>
<form class="mb-3 d-flex justify-content-xs-start justify-content-md-end" id="dropdown-form">
    <div class="row">
        <div class="col-lg-auto mb-3">
            <select class="form-select form-select-md" onchange={onChangeSeason}>
				<option value="-1" disabled>Choose Season...</option>
				{#each seasons as s}
					<option value={s} selected={(season == s)}>{s}</option>
				{/each}
            </select>
        </div>
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeCategory}>
                <option value="-1" disabled>Choose Category...</option>
                <option value="differential" selected={(category == 'differential')}>Net Statistics</option>
                <option value="offensive" selected={(category == 'offensive')}>Offensive</option>
                <option value="defensive" selected={(category == 'defensive')}>Defensive</option>
                {#each extraCategories as c}
                <option value={c} selected={(category == c)}>{toTitleCase(c.replace('-', ' '))}</option>
                {/each}
            </select>
        </div>
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                {#each Object.entries(optGroupMap) as [subcat, metrics]}
                    <optgroup label={toTitleCase(subcat)}>
                        {#each metrics as [key, title]}
                            <option value={key} selected={(metric == key)}>{title}</option>
                        {/each}
                    </optgroup>
                {/each}
            </select>
        </div>
    </div>
</form>
