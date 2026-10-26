<script>
    import { leagueFromLocation, leaguePath } from "../../utils/league";
    import { NATIONAL_TRENDS_METRICS } from "../../utils/constants";

    // one list with the chart titles (nationalTrendsTitle), so a label and its chart never disagree
    const ungrouped = NATIONAL_TRENDS_METRICS.filter((m) => m.group === null);
    const groups = ["Passing", "Rushing", "Other"].map((g) => ({ label: g, metrics: NATIONAL_TRENDS_METRICS.filter((m) => m.group === g) }));

    const { metric, onChangeValue } = $props()

    function onChangeMetric(e) {
        if (onChangeValue) {
            onChangeValue(e.target.value)
        } else {
            window.location = leaguePath(leagueFromLocation(), `/charts/trends?sort=${e.target.value}`);
        }
    }
</script>
<form class="mb-3 d-flex justify-content-xs-start justify-content-md-end" id="dropdown-form">
    <div class="row">
        <div class="col-auto">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                {#each ungrouped as m}
                    <option value={m.key} selected={metric == m.key}>{m.label}</option>
                {/each}
                {#each groups as g}
                    <optgroup label={g.label}>
                        {#each g.metrics as m}
                            <option value={m.key} selected={metric == m.key}>{m.label}</option>
                        {/each}
                    </optgroup>
                {/each}
            </select>
        </div>
    </div>
</form>