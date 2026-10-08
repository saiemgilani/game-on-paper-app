<script lang="ts">
import { parseSpan } from '../../../utils/span';
import TeamMetricsTable from './TeamMetricsTable.svelte';
import BinionBoxScore from './BinionBoxScore.svelte';

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
        <BinionBoxScore season={season} advancedBoxScore={selectedBoxScore} percentiles={percentiles} league={league} />
        <TeamMetricsTable 
            title="Expected Points"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "team.EPA_plays",
                    "team.EPA_overall_total",
                    "team.EPA_overall_offense",
                    "team.EPA_special_teams",
                    "team.EPA_penalty"
                ]
            }
            box={selectedBoxScore}
            useSuffix={true}
            decimalPoints={2}
            caption='Totals may not add up due to plays fitting in multiple categories (e.g. a penalty on a punt).'
        />
        <TeamMetricsTable 
            title="Production"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "team.scrimmage_plays",
                    "team.off_yards",
                    "team.yards_per_play",
                    "team.EPA_overall_off",
                    "team.EPA_per_play",
                    "team.passes",
                    "team.pass_yards",
                    "team.yards_per_pass",
                    "team.EPA_passing_overall",
                    "team.EPA_passing_per_play",
                    "team.rushes",
                    "team.rush_yards",
                    "team.yards_per_rush",
                    "team.EPA_rushing_overall",
                    "team.EPA_rushing_per_play"
                ]
            }
            box={selectedBoxScore}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Rushing"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "team.scrimmage_plays",
                    "team.rushes",
                    "team.rushing_power",
                    "team.rushing_power_success",
                    "team.rushing_stuff",
                    "team.rushing_stopped",
                    "team.rushing_opportunity",
                    "team.line_yards",
                    "team.line_yards_per_carry",
                    "team.rushing_highlight_yards",
                    "team.rushing_highlight_yards_per_opp"
                ]
            }
            box={selectedBoxScore}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Special Teams"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "st_team.fg_attempts",
                    "st_team.kickoff_touchback_rate",
                    "st_team.kickoff_return_avg_allowed",
                    "st_team.punt_net_avg",
                    "st_team.kick_return_avg",
                    "st_team.punt_blocks_by",
                    "st_team.fg_blocks_by"
                ]
            }
            box={selectedBoxScore}
            useSuffix={false}
            decimalPoints={0}
        />
    </div>
    <div class="col-md-4 ms-sm-auto col-lg-4">
        <TeamMetricsTable 
            title="Explosiveness"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "team.EPA_plays",
                    "team.scrimmage_plays",
                    "team.EPA_explosive",
                    "team.EPA_explosive_passing",
                    "team.EPA_explosive_rushing",
                    "team.EPA_non_explosive",
                    "team.EPA_non_explosive_per_play",
                    "team.EPA_non_explosive_passing",
                    "team.EPA_non_explosive_passing_per_play",
                    "team.EPA_non_explosive_rushing",
                    "team.EPA_non_explosive_rushing_per_play"
                ]
            }
            box={selectedBoxScore}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Success"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "situational.EPA_success",
                    "situational.EPA_success_pass",
                    "situational.EPA_success_rush",
                    "situational.EPA_success_standard_down",
                    "situational.EPA_success_passing_down",
                    "situational.EPA_success_early_down",
                    "situational.EPA_success_late_down",
                    "situational.EPA_middle_8_success",
                ]
            }
            box={{
                situational: selectedBoxScore.situational
            }}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Early Downs"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "situational.early_downs",
                    "situational.early_down_first_down",
                    "situational.EPA_early_down",
                    "situational.EPA_early_down_per_play",
                    "situational.early_down_pass",
                    "situational.early_down_rush",
                    "situational.EPA_success_early_down_pass",
                    "situational.EPA_success_early_down_rush",
                ]
            }
            box={{
                situational: selectedBoxScore.situational
            }}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Late Downs"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "situational.late_downs",
                    "situational.EPA_late_down",
                    "situational.EPA_late_down_per_play",
                    "situational.late_down_pass",
                    "situational.late_down_rush",
                    "situational.EPA_success_late_down_pass",
                    "situational.EPA_success_late_down_rush",
                    // "situational.late_down_avg_distance",

                    "team_usage.third_down_opportunities",
                    "team_usage.third_down_conversions",
                    "team_usage.third_down_expected",
                ]
            }
            box={{
                situational: selectedBoxScore.situational,
                team_usage: selectedBoxScore.team_usage
            }}
            useSuffix={true}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Middle 8"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "situational.middle_8",
                    "situational.EPA_middle_8",
                    "situational.EPA_middle_8_per_play",
                    "situational.middle_8_pass",
                    "situational.middle_8_rush",
                    "situational.EPA_middle_8_success_pass",
                    "situational.EPA_middle_8_success_rush"
                ]
            }
            box={{
                situational: selectedBoxScore.situational
            }}
            useSuffix={true}
            decimalPoints={2}
        />
    </div>
    <div class="col-md-4 ms-sm-auto col-lg-4">
        <TeamMetricsTable 
            title="Drives"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "drives.drives",
                    "drives.avg_field_position",
                    "drives.plays_per_drive",
                    "drives.yards_per_drive",
                    "drives.drive_total_gained_yards_rate",

                    "team_usage.so_trips",
                    "team_usage.so_touchdown_rate",
                    "team_usage.so_points_per_trip",
                    "team_usage.so_success_rate",
                    "team_usage.so_epa_per_play",

                    "team_usage.rz_trips",
                    "team_usage.rz_touchdown_rate",
                    "team_usage.rz_points_per_trip",
                    "team_usage.rz_success_rate",
                    "team_usage.rz_epa_per_play",

                    "drive_scripting.scripted.drives",
                    "drive_scripting.scripted.success_rate",
                    "drive_scripting.scripted.epa_per_play",
                    "drive_scripting.scripted.points_per_drive",

                    "drive_scripting.non_scripted.drives",
                    "drive_scripting.non_scripted.success_rate",
                    "drive_scripting.non_scripted.epa_per_play",
                    "drive_scripting.non_scripted.points_per_drive",
                ]
            }
            box={{
                drives: selectedBoxScore.drives,
                team_usage: selectedBoxScore.team_usage,
                drive_scripting: selectedBoxScore.drive_scripting
            }}
            useSuffix={false}
            decimalPoints={2}
        />
        <TeamMetricsTable 
            title="Defensive"
            league={league}
            teamKey='def_pos_team'
            season={season}
            columns={
                [
                    "defensive.scrimmage_plays",
                    "defensive.drive_stopped_rate",
                    "defensive.havoc_total",
                    "defensive.havoc_total_pass",
                    "defensive.havoc_total_rush",
                    "defensive.TFL",
                    "defensive.TFL_pass",
                    "defensive.TFL_rush",
                    "defensive.sacks",
                    "defensive.pass_breakups",
                    "defensive.def_int",
                    "defensive.fumbles"
                ]
            }
            box={{
                defensive: selectedBoxScore.defensive
            }}
            useSuffix={true}
            decimalPoints={0}
        />
        <TeamMetricsTable 
            title="Turnovers"
            league={league}
            teamKey='pos_team'
            season={season}
            columns={
                [
                    "turnover.turnovers",
                    "turnover.total_fumbles",
                    "turnover.fumbles_lost",
                    "turnover.fumbles_recovered",
                    "turnover.Int",
                    "turnover.turnover_margin",
                    "turnover.expected_turnovers",
                    "turnover.expected_turnover_margin",
                    "turnover.turnover_luck"
                ]
            }
            box={{
                turnover: selectedBoxScore.turnover
            }}
            useSuffix={false}
            decimalPoints={2}
        />
    </div>
</div>