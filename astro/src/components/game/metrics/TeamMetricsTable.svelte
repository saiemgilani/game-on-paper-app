<script lang="ts">
import type { ProcessedTeamMetricBoxScore } from '../../../resources/python';
import { espnLogoLeague, leagueFromLocation } from '../../../utils/league';
import { leaguePath } from '../../../utils/league';
import { METRIC_KEY_TITLE_MAPPING, BOX_SCORE_NON_RATE_PERCENT_COLUMNS, BOX_SCORE_NON_RATE_DECIMAL_COLUMNS, BOX_SCORE_NON_RATE_COLUMNS } from '../../../utils/constants';
import { metricDecimalPoints, roundNumber } from '../../../utils/misc';

interface Props {
    title: string
    teamKey: string
    season: number
    columns: string[]
    teamBoxScores: ProcessedTeamMetricBoxScore[]
    useSuffix: boolean
    decimalPoints: number
    caption?: string
}
const { title, teamKey, season, columns, teamBoxScores, useSuffix, decimalPoints, caption = null } = $props();

const groups = teamBoxScores.map((group: any) => group[teamKey]);

function handleMetricRows(item: string): string {
    const finalDecimalPoints = metricDecimalPoints(decimalPoints);
    var result = ""
    if (item == "EPA_misc") {
        teamBoxScores.forEach((teamData: any) => {
            let overall = parseFloat(teamData['EPA_overall_total'] || 0);
            let off = parseFloat(teamData['EPA_overall_offense'] || 0);
            let sp_epa = parseFloat(teamData['EPA_special_teams'] || 0);
            let pen_epa = parseFloat(teamData['EPA_penalty'] || 0);
            let val = (overall - off - sp_epa - pen_epa)
            result += `<td class="numeral" style="text-align: center;">${roundNumber(val, 2, 2)}</td>`;
        });
    } else if (item == "off_yards") {
        // The row is labelled "Yards" under the overall block and the pass and
        // rush "Yards" rows sit right under it, so the header promises their
        // sum. The payload's own off_yards is ESPN's per-play statYardage --
        // a different universe from the processor's parsed pass/rush yardage,
        // and off by up to 31 yards on a single game -- so it is shown as the
        // tooltip instead of as the total.
        teamBoxScores.forEach((teamData: any) => {
            let val = parseFloat(teamData['pass_yards'] || 0) + parseFloat(teamData['rush_yards'] || 0);
            result += `<td class="numeral" style="text-align: center;" title="ESPN: ${teamData['off_yards'] || 0}">${val}</td>`;
        });
    } else if (item == "avg_field_position") {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            let prefix = (val >= 50) ? "Own" : "Opp"
            let printedVal = (val >= 50) ? (100 - parseFloat(val)) : val
            result += `<td class="numeral" style="text-align: center;">${prefix} ${roundNumber(printedVal, 2, 0)}</td>`;
        });
    } else if (BOX_SCORE_NON_RATE_PERCENT_COLUMNS.includes(item)) {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            result += `<td class="numeral" style="text-align: center;">${roundNumber(parseFloat(val), 2, 0)}%</td>`;
        });
    } else if (BOX_SCORE_NON_RATE_DECIMAL_COLUMNS.includes(item)) {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            result += `<td class="numeral" style="text-align: center;">${roundNumber(parseFloat(val), 2, finalDecimalPoints)}</td>`;
        });
    } else if (BOX_SCORE_NON_RATE_COLUMNS.includes(item)) {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            result += `<td class="numeral" style="text-align: center;">${val}</td>`;
        });
    } else {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            var rate = 0.0;
            if (useSuffix) {
                rate = 100.0 * teamData[`${item}_rate`]
            } else {
                rate = 100.0 * (parseFloat(val) / parseFloat(teamData["scrimmage_plays"]))
            }
            result += `<td class="numeral" style="text-align: center;">${val} (${roundNumber(rate, 2, 0)}%)</td>`;
        });
    }
    return result;
}
</script>

<div class="table-responsive">
    <table class="table table-sm table-responsive">
        {#if caption}
            <caption class="text-muted text-small">{caption}</caption>
        {/if}
        <thead>
            <tr>
                <th class="box-heading">{title}</th>
                {#each groups as value}
                    <th style="text-align: center;"><a href={leaguePath(leagueFromLocation(), `/year/${season}/team/${value}`)}><img class={`img-fluid team-logo-${value}`} width="35px" src={`https://a.espncdn.com/i/teamlogos/${espnLogoLeague(leagueFromLocation())}/500/${value}.png`} alt={`ESPN team id ${value}`}/></a></th>
                {/each}
            </tr>
        </thead>
        <tbody>
            {#each columns as item}
                <tr>
                        <td style="text-align: left;">{@html METRIC_KEY_TITLE_MAPPING[item] || item}</td>
                        {@html handleMetricRows(item)}
                </tr>
            {/each}
        </tbody>
    </table>
</div>