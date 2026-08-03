<script>
    import { SDV_TEAM_METRIC_CATEGORIES } from "../../utils/constants";
    import { toTitleCase } from "../../utils/misc";

    const { category, metric, onChangeValue } = $props()

    function onChangeCategory(e) {
        onChangeValueWrapper(e.target.value, metric)
    }

    function onChangeMetric(e) {
        onChangeValueWrapper(category, e.target.value)
    }

    function onChangeValueWrapper(c, m) {
        if (c == "offensive" && ["adj_def_epa", "net_adj_epa"].includes(m)) {
            m = "adj_off_epa"
        } else if (c == "defensive" && ["adj_off_epa", "net_adj_epa"].includes(m)) {
            m = "adj_def_epa"
        } else if (c == "differential" && ["adj_off_epa", "adj_def_epa"].includes(m)) {
            m = "net_adj_epa"
        } else if (c == "offensive" && (m.includes("_def") || m.includes("_margin"))) {
            m = m.replace("_def", "_off").replace("_margin", "_off")
        } else if (c == "defensive" && (m.includes("_off") || m.includes("_margin"))) {
            m = m.replace("_off", "_def").replace("_margin", "_def")
        } else if (c == "differential" && (m.includes("_off") || m.includes("_def"))) {
            m = m.replace("_off", "_margin").replace("_def", "_margin")
        }

		if (onChangeValue) {
            onChangeValue(c, m)
        } else {
            window.location = `/teams/${c}?sort=${m}`;
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
<form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start" id="dropdown-form">
    <div class="row">
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeCategory}>
                <option value="-1" disabled>Choose Category...</option>
                <option value="differential" selected={(category == 'differential')}>Net Statistics</option>
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