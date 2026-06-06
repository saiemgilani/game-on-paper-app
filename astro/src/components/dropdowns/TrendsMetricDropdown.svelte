<script>
    const { category, metric, isFixedSeason, onChangeValue } = $props()

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
            window.location = `/trends?category=${category}&metric=${metric}`;
        }
    }
</script>
<form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start" id="dropdown-form">
    <div class="row">
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeCategory}>
                <option value="-1" disabled>Choose Category...</option>
                <option value="offensive" selected={(category == 'offensive')}>Offensive</option>
                <option value="defensive" selected={(category == 'defensive')}>Defensive</option>
            </select>
        </div>
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                <option value="overall.epaPerPlay" selected={(metric == 'overall.epaPerPlay')}>EPA/Play</option>
                <option value="overall.yardsPerPlay" selected={(metric == 'overall.yardsPerPlay')}>Yards/Play</option>
                <option value="overall.successRate" selected={(metric == 'overall.successRate')}>SR%</option>

                <optgroup label="Passing">
                    <option value="passing.epaPerPlay" selected={(metric == 'passing.epaPerPlay')}>EPA/DB</option>
                    <option value="passing.yardsPerPlay" selected={(metric == 'passing.yardsPerPlay')}>Yards/DB</option>
                    <option value="passing.successRate" selected={(metric == 'passing.successRate')}>Pass SR%</option>
                    <option value="passing.explosiveRate" selected={(metric == 'passing.explosiveRate')}>Pass Expl %</option>
                </optgroup>
                <optgroup label="Rushing">
                    <option value="rushing.epaPerPlay" selected={(metric == 'rushing.epaPerPlay')}>EPA/Rush</option>
                    <option value="rushing.yardsPerPlay" selected={(metric == 'rushing.yardsPerPlay')}>Yards/Rush</option>
                    <option value="rushing.successRate" selected={(metric == 'rushing.successRate')}>Rush SR%</option>
                    <option value="rushing.explosiveRate" selected={(metric == 'rushing.explosiveRate')}>Rush Expl %</option>
                    <option value="rushing.opportunityRate" selected={(metric == 'rushing.opportunityRate')}>Opportunity %</option>
                    <option value="rushing.lineYards" selected={(metric == 'rushing.lineYards')}>Line Yards</option>
                    <option value="rushing.stuffedPlayRate" selected={(metric == 'rushing.stuffedPlayRate')}>Stuffed %</option>
                </optgroup>
                <optgroup label="Other">
                    <option value="overall.havocRate" selected={(metric == 'overall.havocRate')}>Havoc %</option>
                    <option value="overall.explosiveRate" selected={(metric == 'overall.explosiveRate')}>Explosive %</option>
                    <option value="overall.nonExplosiveEpaPerPlay" selected={(metric == 'overall.nonExplosiveEpaPerPlay')}>Non-Expl EPA/Play</option>
                    <option value="overall.earlyDownEPAPerPlay" selected={(metric == 'overall.earlyDownEPAPerPlay')}>Early Downs EPA/Play</option>
                    <option value="overall.lateDownSuccessRate" selected={(metric == 'overall.lateDownSuccessRate')}>Late Downs SR%</option>
                    <option value="overall.thirdDownDistance" selected={(metric == 'overall.thirdDownDistance')}>Avg Distance (3rd)</option>
                </optgroup>
            </select>
        </div>
    </div>
</form>