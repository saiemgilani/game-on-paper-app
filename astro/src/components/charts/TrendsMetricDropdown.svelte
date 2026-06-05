<script>
    const { category, metric } = $props()

	let selectedCategory = $state({ value: category || "-1" });
	let selectedMetric = $state({ value: metric || "-1" });

    function onChangeMetric(e) {
        selectedMetric.value = e.target.value;

        window.location = `/cfb/trends` + (new URLSearchParams({ category: selectedCategory.value, metric: selectedMetric.value })).toString();
    }

</script>
<form class="mb-3 d-flex justify-content-lg-end justify-content-xs-start" id="dropdown-form">
    <div class="row">
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={(e) => selectedCategory.value = e.target.value}>
                <option value="-1" disabled>Choose Type...</option>
                <option value="offensive" selected={(selectedCategory.value == 'offensive')}>Offensive</option>
                <option value="defensive" selected={(selectedCategory.value == 'defensive')}>Defensive</option>
            </select>
        </div>
        <div class="col-auto mb-xs-3 mb-sm-0">
            <select class="form-select form-select-md" onchange={onChangeMetric}>
                <option value="-1" disabled>Choose Metric...</option>
                <optgroup label="Overall">
                    <option value="overall.epaPerPlay" selected={(selectedMetric.value == 'overall.epaPerPlay')}>EPA/Play</option>
                    <option value="overall.yardsPerPlay" selected={(selectedMetric.value == 'overall.yardsPerPlay')}>Yards/Play</option>
                    <option value="overall.successRate" selected={(selectedMetric.value == 'overall.successRate')}>SR%</option>
                </optgroup>
                    <optgroup label="Passing" hidden={selectedCategory.value == "-1"}>
                        <option value="passing.epaPerPlay" selected={(selectedMetric.value == 'passing.epaPerPlay')}>EPA/DB</option>
                        <option value="passing.yardsPerPlay" selected={(selectedMetric.value == 'passing.yardsPerPlay')}>Yards/DB</option>
                        <option value="passing.successRate" selected={(selectedMetric.value == 'passing.successRate')}>Pass SR%</option>
                        <option value="passing.explosiveRate" selected={(selectedMetric.value == 'passing.explosiveRate')}>Pass Expl %</option>
                    </optgroup>
                    <optgroup label="Rushing" hidden={selectedCategory.value == "-1"}>
                        <option value="rushing.epaPerPlay" selected={(selectedMetric.value == 'rushing.epaPerPlay')}>EPA/Rush</option>
                        <option value="rushing.yardsPerPlay" selected={(selectedMetric.value == 'rushing.yardsPerPlay')}>Yards/Rush</option>
                        <option value="rushing.successRate" selected={(selectedMetric.value == 'rushing.successRate')}>Rush SR%</option>
                        <option value="rushing.explosiveRate" selected={(selectedMetric.value == 'rushing.explosiveRate')}>Rush Expl %</option>
                        <option value="rushing.opportunityRate" selected={(selectedMetric.value == 'rushing.opportunityRate')}>Opportunity %</option>
                        <option value="rushing.lineYards" selected={(selectedMetric.value == 'rushing.lineYards')}>Line Yards</option>
                        <option value="rushing.stuffedPlayRate" selected={(selectedMetric.value == 'rushing.stuffedPlayRate')}>Stuffed %</option>
                    </optgroup>
                    <optgroup label="Other" hidden={selectedCategory.value == "-1"}>
                        <option value="overall.havocRate" selected={(selectedMetric.value == 'overall.havocRate')}>Havoc %</option>
                        <option value="overall.explosiveRate" selected={(selectedMetric.value == 'overall.explosiveRate')}>Explosive %</option>
                        <option value="overall.nonExplosiveEpaPerPlay" selected={(selectedMetric.value == 'overall.nonExplosiveEpaPerPlay')}>Non-Expl EPA/Play</option>
                        <option value="overall.earlyDownEPAPerPlay" selected={(selectedMetric.value == 'overall.earlyDownEPAPerPlay')}>Early Downs EPA/Play</option>
                        <option value="overall.lateDownSuccessRate" selected={(selectedMetric.value == 'overall.lateDownSuccessRate')}>Late Downs SR%</option>
                        <option value="overall.thirdDownDistance" selected={(selectedMetric.value == 'overall.thirdDownDistance')}>Avg Distance (3rd)</option>
                    </optgroup>
            </select>
        </div>
    </div>
</form>

<!-- <script src="/assets/js/feather.min.js" crossorigin="anonymous"></script>
<script src="/assets/js/Chart.min.js" crossorigin="anonymous"></script>
<script src="/assets/js/d3-regression.min.js" crossorigin="anonymous"></script>
<script src="/assets/js/common.js" crossorigin="anonymous"></script>
<script src="/assets/js/Chart.BoxPlot.min.js" crossorigin="anonymous"></script>
<script src="/assets/js/team_chart.js" crossorigin="anonymous"></script>
<script>
    const percentiles = <%- JSON.stringify(percentiles) %>;
    (function() {
        'use strict'
        feather.replace()
        const teamChart = new Chart(
            document.getElementById('metric_chart_canvas'),
            generateTeamChartConfig("National Trends", null, [], percentiles, "<%= type %>", "<%= metric %>")
        )
    })()
</script> -->