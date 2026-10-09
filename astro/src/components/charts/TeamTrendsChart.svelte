<script lang="ts">
    import TeamTrendsMetricDropdown from '../dropdowns/TeamTrendsMetricDropdown.svelte';
    import TrendsChart from './TrendsChart.svelte';
    import { EVENT_KEY_TRENDS_METRIC_CHANGED } from '../../utils/constants';
    import { leagueFromLocation } from '../../utils/league';

    // No national bands behind a team's season means: the only published ones are
    // the single-GAME ladder, which made every season look average (audit C7). With
    // none, TrendsChart draws the team's own trend line, as the Net view always has.
    const { title, teamColor, teamData } = $props();
    let selectedCategory = "offensive"
    let selectedMetric = "EPAplay_off"

    function onChangeValue(category: string, metric: string) {
        selectedCategory = category;
        selectedMetric = metric;

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
            <p class="text-small text-muted">{leagueFromLocation() === 'cfb' ? 'Data shown is from FBS vs FBS games only.' : 'Data shown is from regular season games only.'}</p>
        </div>
        <div class="ms-auto col-lg-6 col-xs-12">
            <TeamTrendsMetricDropdown category={selectedCategory} metric={selectedMetric} onChangeValue={onChangeValue} />
        </div>
    </div>
   <TrendsChart title={title} teamColor={teamColor} teamData={teamData} category={selectedCategory} metric={selectedMetric} percentiles={[]} />
</div>
