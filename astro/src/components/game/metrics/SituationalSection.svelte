<script lang="ts">
import type { ProcessedBoxScore } from '../../../resources/python';
import type { League } from '../../../utils/league';
import { parseSpan } from '../../../utils/span';
// import { periodSplits, situationalRows } from '../../../utils/situational';
// import { espnLogoLeague, type League } from '../../../utils/league';
// import { leaguePath } from '../../../utils/league';
// import { roundNumber } from '../../../utils/misc';
// import FilterGroup from '../../../layouts/FilterGroup.astro';
// import type { ProcessedBoxScore } from '../../../resources/python';
// import type { SDVSeasonPercentile } from '../../../resources/sdv';
import TeamMetricsTable from './TeamMetricsTable.svelte';
import BinionBoxScore from './BinionBoxScore.svelte';
// import PenaltyBreakdown from './PenaltyBreakdown.astro';
// import TraditionalTeamStats from './TraditionalTeamStats.astro';

const EMPTY_PROCESSED_BOX_SCORE = {
  defensive: [],
  drives: [],
  pass: [],
  receiver: [],
  rush: [],
  situational: [],
  team: [],
  turnover: [],
}

const { season, advBoxScoreSpans, league, percentiles } = $props();
const availableSpans = Object.keys(advBoxScoreSpans).map(parseSpan).filter(p => !!p)
let selectedSpan = $state("all");
let selectedBoxScore = $derived(advBoxScoreSpans[selectedSpan] || EMPTY_PROCESSED_BOX_SCORE)

function onChangeSpan(e: Event) {
    selectedSpan = (e.target as HTMLSelectElement).value
}
</script>
<div class="d-flex flex-wrap gap-2 align-items-center mb-2 mt-1">
    <label class="text-small text-muted" for="span-stats">Show only</label>
    <select id="span-stats" aria-label="Show only this period of metrics" class="form-select form-select-sm" style="width:auto;min-width:250px" onchange={onChangeSpan}>
        <option value="all" selected={"all" == selectedSpan}>Game</option>
        {#each availableSpans as s}
        <option value={s.key} selected={s.key == selectedSpan}>{s.label}</option>
        {/each}
    </select>
</div>
<div class="row">
    <div class="col-md-4 ms-sm-auto col-lg-4">
        {#if league == "cfb"}
        <BinionBoxScore season={season} advancedBoxScore={selectedBoxScore} percentiles={percentiles} />
        {/if}
        <TeamMetricsTable 
            title="Expected Points"
            teamKey='pos_team'
            season={season}
            columns={[
                "EPA_plays","EPA_overall_total", "EPA_overall_offense", "EPA_special_teams", "EPA_penalty"                                 
            ]}
            teamBoxScores={selectedBoxScore.team}
            useSuffix={true}
            decimalPoints={2}
            caption='Totals may not add up due to plays fitting in multiple categories (e.g. a penalty on a punt).'
        />
        <TeamMetricsTable 
            title="Production"
            teamKey='pos_team'
            season={season}
            columns={[
                "scrimmage_plays","off_yards","yards_per_play","EPA_overall_off","EPA_per_play","passes","pass_yards","yards_per_pass","EPA_passing_overall","EPA_passing_per_play","rushes","rush_yards","yards_per_rush", "EPA_rushing_overall","EPA_rushing_per_play"                                    
            ]}
            teamBoxScores={selectedBoxScore.team}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Rushing"
            teamKey='pos_team'
            season={season}
            columns={[
                "scrimmage_plays","rushes","rushing_power","rushing_power_success","rushing_stuff","rushing_stopped","rushing_opportunity","line_yards","line_yards_per_carry","rushing_highlight_yards","rushing_highlight_yards_per_opp"                                
            ]}
            teamBoxScores={selectedBoxScore.team}
            useSuffix={true}
            decimalPoints={2}
        />
    </div>
    <div class="col-md-4 ms-sm-auto col-lg-4">
        <TeamMetricsTable 
            title="Explosiveness"
            teamKey='pos_team'
            season={season}
            columns={[
                "EPA_plays","scrimmage_plays","EPA_explosive","EPA_explosive_passing","EPA_explosive_rushing","EPA_non_explosive","EPA_non_explosive_per_play","EPA_non_explosive_passing","EPA_non_explosive_passing_per_play","EPA_non_explosive_rushing","EPA_non_explosive_rushing_per_play"
            ]}
            teamBoxScores={selectedBoxScore.team}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Situational"
            teamKey='pos_team'
            season={season}
            columns={[
                "EPA_success",
                "EPA_success_pass",
                "EPA_success_rush",
                "EPA_success_standard_down",
                "EPA_success_passing_down",
                "EPA_success_early_down",
                "EPA_success_late_down",
                "EPA_middle_8_success",
                "early_downs",
                "early_down_first_down",
                "EPA_early_down",
                "EPA_early_down_per_play",
                "early_down_pass",
                "early_down_rush",
                "EPA_success_early_down_pass",
                "EPA_success_early_down_rush",
                "late_downs",
                "EPA_late_down",
                "EPA_late_down_per_play",
                "late_down_pass",
                "late_down_rush",
                "EPA_success_late_down_pass",
                "EPA_success_late_down_rush",
                "late_down_avg_distance",

                "middle_8",
                "EPA_middle_8",
                "EPA_middle_8_per_play",
                "middle_8_pass",
                "middle_8_rush",
                "EPA_middle_8_success_pass",
                "EPA_middle_8_success_rush"
            ]}
            teamBoxScores={selectedBoxScore.situational}
            useSuffix={true}
            decimalPoints={2}
        />
    </div>
    <div class="col-md-4 ms-sm-auto col-lg-4">
        <TeamMetricsTable 
            title="Drives"
            teamKey='pos_team'
            season={season}
            columns={[
                "drives",
                "avg_field_position",
                "plays_per_drive",
                "yards_per_drive",
                "drive_total_gained_yards_rate"
            ]}
            teamBoxScores={selectedBoxScore.drives}
            useSuffix={false}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Defensive"
            teamKey='def_pos_team'
            season={season}
            columns={[
                "scrimmage_plays","drive_stopped_rate","havoc_total","havoc_total_pass","havoc_total_rush","TFL","TFL_pass","TFL_rush", "sacks","PD","def_int","fumbles"
            ]}
            teamBoxScores={selectedBoxScore.defensive}
            useSuffix={true}
            decimalPoints={0}
        />
        <TeamMetricsTable 
            title="Turnovers"
            teamKey='pos_team'
            season={season}
            columns={[
                "turnovers","total_fumbles","fumbles_lost","fumbles_recovered","Int","turnover_margin","expected_turnovers","expected_turnover_margin","turnover_luck"
            ]}
            teamBoxScores={selectedBoxScore.turnover}
            useSuffix={false}
            decimalPoints={0}
        />
        <!-- <TraditionalTeamStats
            season={season}
            teams={selectedBoxScore.team.map((t: any) => t.pos_team)}
            plays={game.plays}
            drives={spanDrives}
        />
        <PenaltyBreakdown
            season={season}
            teams={selectedBoxScore.team.map((t: any) => t.pos_team)}
            plays={game.plays}
        /> -->
    </div>
</div>