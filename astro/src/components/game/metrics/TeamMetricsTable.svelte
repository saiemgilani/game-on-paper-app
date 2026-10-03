<script lang="ts">
import type { ProcessedBoxScore, ProcessedTeamMetricBoxScore } from '../../../resources/python';
import { espnLogoLeague, type League } from '../../../utils/league';
import { leaguePath } from '../../../utils/league';
import { METRIC_KEY_TITLE_MAPPING, BOX_SCORE_NON_RATE_PERCENT_COLUMNS, BOX_SCORE_NON_RATE_DECIMAL_COLUMNS, BOX_SCORE_NON_RATE_COLUMNS } from '../../../utils/constants';
import { metricDecimalPoints, roundNumber } from '../../../utils/misc';

interface Props {
    title: string
    league: League
    teamKey: string
    season: number
    columns: string[]
    box?: Partial<ProcessedBoxScore>
    useSuffix: boolean
    decimalPoints: number
    caption?: string
}
const { title, league, teamKey, season, columns, box, useSuffix, decimalPoints, caption }: Props = $props();

const keys: string[] = box ? (box as any)[Object.keys(box || {})[0]].map((group: any) => group[teamKey]) : [];

const groups = [...new Set(keys || [])];

function handleMetricRows(rowKey: string): string {
    const finalDecimalPoints = metricDecimalPoints(decimalPoints);
    if (rowKey.length == 0) {
        return ""
    }
    const splitKeys = rowKey.split(".");

    let item: string;
    let boxKey: string;
    if (splitKeys.length == 1) {
        item = splitKeys[0];
        boxKey = Object.keys(box || {})[0];
    } else {
        item = splitKeys.slice(1).join(".");
        boxKey = splitKeys[0];
    }

    let teamBoxScores: ProcessedTeamMetricBoxScore[] = box ? ((box as any)[boxKey] || []) : [];
    teamBoxScores.sort((a, b) => keys.indexOf((a as any)[teamKey]) - keys.indexOf((b as any)[teamKey]) )

    let result = ""
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
    } else if (item == "yards_per_play") {
        // This has to be based the updated off_yards above to remain consistent.
        teamBoxScores.forEach((teamData: any) => {
            const scrimmagePlays = teamData["scrimmage_plays"]
            if (!scrimmagePlays || scrimmagePlays == "0") {
                result += `<td class="numeral" style="text-align: center;" title="ESPN: ${teamData['yards_per_play'] || 0}"> - </td>`;
            } else {
                let val = (parseFloat(teamData['pass_yards'] || 0) + parseFloat(teamData['rush_yards'] || 0)) / parseFloat(scrimmagePlays);
                result += `<td class="numeral" style="text-align: center;" title="ESPN: ${teamData['yards_per_play'] || 0}">${roundNumber(val, 2, 2)}</td>`;
            }
        });
    }  else if (item == "avg_field_position") {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            let prefix = (val >= 50) ? "Own" : "Opp"
            let printedVal = (val >= 50) ? (100 - parseFloat(val)) : val
            result += `<td class="numeral" style="text-align: center;">${prefix} ${roundNumber(printedVal, 2, 0)}</td>`;
        });
    } else if (["drive_total_gained_yards_rate"].includes(item)) {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            result += `<td class="numeral" style="text-align: center;">${roundNumber(parseFloat(val), 2, 0)}%</td>`;
        });
    }  else if (["kickoff_touchback_rate", "rz_success_rate", "so_success_rate", "rz_touchdown_rate", "so_touchdown_rate"].includes(item)) {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            result += `<td class="numeral" style="text-align: center;">${roundNumber(parseFloat(val) * 100, 2, 0)}%</td>`;
        });
    } else if (["fg_attempts"].includes(item)) {
        teamBoxScores.forEach((teamData: any) => {
            let denom = teamData[item] || 0;
            let num = teamData["fg_made"] || 0;
            let pct = (denom == 0) ? 0 : num / denom
            if (denom == 0) {
                result += `<td class="numeral" style="text-align: center;"> - </td>`;
            } else {
                result += `<td class="numeral" style="text-align: center;">${num}/${denom} (${roundNumber(pct * 100, 2, 0)}%)</td>`;
            }
        });
    } else if (["third_down_conversions", "third_down_expected"].includes(item)) {
        teamBoxScores.forEach((teamData: any) => {
            let denom = teamData["third_down_opportunities"] || 0;
            let num = teamData[item] || 0;
            let pct = (denom == 0) ? 0 : num / denom
            let places = item == "third_down_expected" ? 1 : 0
            if (denom == 0) {
                result += `<td class="numeral" style="text-align: center;"> - </td>`;
            } else {
                result += `<td class="numeral" style="text-align: center;">${roundNumber(num, 2, places)} (${roundNumber(pct * 100, 2, 0)}%)</td>`;
            }
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
    } else if (item.startsWith("scripted.") || item.startsWith("non_scripted.")) {
        const script = item.split(".")[0]
        const metric = item.replace(script + ".", "")
        for (const teamData of teamBoxScores) {
            if ((teamData as any)["script"] != script) {
                continue;
            }

            let val = (teamData as any)[metric] || 0;
            if (["epa_per_play", "points_per_drive"].includes(metric)) {
                result += `<td class="numeral" style="text-align: center;">${roundNumber(val, 2, 2)}</td>`;
            } else if (metric == "success_rate") {
                result += `<td class="numeral" style="text-align: center;">${roundNumber(val * 100, 2, 0)}%</td>`;
            } else {
                result += `<td class="numeral" style="text-align: center;">${val}</td>`;
            }
        }
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

function getMetricTitle(rowKey: string): string {
    const splitKeys = rowKey.split(".");
    const item = splitKeys.length > 1 ? splitKeys.slice(1).join(".") : splitKeys[0];
    return METRIC_KEY_TITLE_MAPPING[item] || item
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
                    <th style="text-align: center;"><a href={leaguePath(league, `/year/${season}/team/${value}`)}><img class={`img-fluid team-logo-${value}`} width="35px" src={`https://a.espncdn.com/i/teamlogos/${espnLogoLeague(league)}/500/${value}.png`} alt={`ESPN team id ${value}`}/></a></th>
                {/each}
            </tr>
        </thead>
        <tbody>
            {#each columns as item}
                <tr>
                        <td style="text-align: left;">{@html getMetricTitle(item)}</td>
                        {@html handleMetricRows(item)}
                </tr>
            {/each}
        </tbody>
    </table>
</div>