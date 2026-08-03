<script lang="ts">
    import TeamTrendsMetricDropdown from '../dropdowns/TeamTrendsMetricDropdown.svelte';
    import TrendsChart from './TrendsChart.svelte';
    import { type ValuePercentile } from '../../resources/chart';
    import { getPercentileKey } from '../../utils/misc';
    import { EVENT_KEY_TRENDS_METRIC_CHANGED } from '../../utils/constants';

    const { title, teamColor, teamData, percentiles } = $props();
    let selectedCategory = "offensive"
    let selectedMetric = "EPAplay_off"
    let selectedPercentiles: ValuePercentile[] = $state([])

    function onChangeValue(category: string, metric: string) {
        selectedCategory = category;
        selectedMetric = metric;

        if (selectedCategory != "differential") {
            const pctlKey = getPercentileKey(selectedMetric)
            selectedPercentiles = percentiles.map((p: any) => {
                return {
                    season: p["season"] || 2025,
                    pctile: p["pctile"],
                    value: p[pctlKey]
                }
            }).filter((p: any) => (p["value"] !== undefined) && (p["value"] != null))
        } else {
            selectedPercentiles = []
        }

        const changeEvent = new CustomEvent(EVENT_KEY_TRENDS_METRIC_CHANGED, { detail: { category, metric }})
        console.log("firing event: " + EVENT_KEY_TRENDS_METRIC_CHANGED)
        document.dispatchEvent(changeEvent)
    }

    onChangeValue(selectedCategory, selectedMetric)    
</script>

<div class="container">
    <div class="row mb-3">
        <div class="col-lg-6 col-xs-12">
            <h2 id="metricHistory" class="d-inline">Metric History</h2>
            <p class="text-small text-muted">Data shown is from FBS vs FBS games only.</p>
        </div>
        <div class="ms-auto col-lg-6 col-xs-12">
            <TeamTrendsMetricDropdown category={selectedCategory} metric={selectedMetric} onChangeValue={onChangeValue} />
        </div>
    </div>
   <TrendsChart title={title} teamColor={teamColor} teamData={teamData} category={selectedCategory} metric={selectedMetric} percentiles={selectedPercentiles} />
</div>
