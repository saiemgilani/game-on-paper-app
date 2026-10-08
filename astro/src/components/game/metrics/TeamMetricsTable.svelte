<script lang="ts">
import type { ProcessedBoxScore, ProcessedTeamMetricBoxScore } from '../../../resources/python';
import { espnLogoLeague, type League } from '../../../utils/league';
import { leaguePath } from '../../../utils/league';
import { METRIC_KEY_TITLE_MAPPING, BOX_SCORE_NON_RATE_PERCENT_COLUMNS, BOX_SCORE_NON_RATE_DECIMAL_COLUMNS, BOX_SCORE_NON_RATE_COLUMNS } from '../../../utils/constants';
import { formatNumber, metricDecimalPoints, offenseYardsPerPlay, roundNumber } from '../../../utils/misc';

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

const keys: string[] = box ? (box as any)[Object.keys(box || {})[0]].map((group: any) => String(group[teamKey])) : [];
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
    // `keys` are strings and the payload's ids are numbers: compare like with like, or
    // every row is -1 and the sections keep whatever order they arrived in
    teamBoxScores = teamBoxScores.toSorted((a, b) => keys.indexOf(String((a as any)[teamKey])) - keys.indexOf(String((b as any)[teamKey])));

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
        // The overall "Yards" row is the payload's net total: statYardage over
        // scrimmage plays, so the yards lost on sacks are in it, and it is exactly
        // what Yards/Play below is yards over. The pass and rush "Yards" rows
        // under it are the parsed receiving and rushing yards; a sack is in
        // neither, so their sum reads higher (on 62% of 2025 team-games by
        // exactly the sack yardage) and is shown as the tooltip.
        teamBoxScores.forEach((teamData: any) => {
            const gross = parseFloat(teamData['pass_yards'] || 0) + parseFloat(teamData['rush_yards'] || 0);
            result += `<td class="numeral" style="text-align: center;" title="Pass + rush: ${gross}">${roundNumber(teamData['off_yards'] || 0, 2, 0)}</td>`;
        });
    } else if (item == "yards_per_play") {
        // Sack yardage included (offenseYardsPerPlay): the "Yards" row above over the
        // scrimmage plays. The tooltip spells that division out.
        teamBoxScores.forEach((teamData: any) => {
            const val = offenseYardsPerPlay(teamData);
            const title = `${teamData['off_yards'] ?? 0} net yards (sacks included) on ${teamData['scrimmage_plays'] ?? 0} plays`;
            result += `<td class="numeral" style="text-align: center;" title="${title}">${val === null ? '—' : roundNumber(val, 2, 2)}</td>`;
        });
    }  else if (item == "avg_field_position") {
        teamBoxScores.forEach((teamData: any) => {
            let val = teamData[item] || 0;
            let prefix = (val >= 50) ? "Own" : "Opp"
            let printedVal = (val >= 50) ? (100 - parseFloat(val)) : val
            result += `<td class="numeral" style="text-align: center;">${prefix} ${roundNumber(printedVal, 2, 0)}</td>`;
        });
    } else if (item == "avg_start_ep") {
        // EP of the drive starts; a team with no drive in the window is absent, not 0
        teamBoxScores.forEach((teamData: any) => {
            result += `<td class="numeral" style="text-align: center;">${formatNumber(teamData[item], 2)}</td>`;
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
                result += `<td class="numeral" style="text-align: center;">—</td>`;
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
                result += `<td class="numeral" style="text-align: center;">—</td>`;
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
        // One cell per header team, found by team id. A team with no drive of this kind
        // in the span has no row at all, so reading the rows in order would put the other
        // team's numbers under its logo; it gets a dash instead.
        for (const team of groups) {
            const teamData = teamBoxScores.find((row: any) => String(row[teamKey]) === team && row["script"] === script) as any;
            const val = teamData?.[metric];
            if (val === undefined || val === null) {
                result += `<td class="numeral" style="text-align: center;">—</td>`;
            } else if (["epa_per_play", "points_per_drive"].includes(metric)) {
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

const V2_METRIC_KEY_TITLE_MAPPING_OVERRIDES: Record<string, string> = {
    "EPA_success" : "Plays",
    "EPA_success_pass" : "When Passing",
    "EPA_success_rush" : "When Rushing",
    "EPA_success_standard_down" : "On Standard Downs",
    "EPA_success_passing_down": "On Passing Downs",
    "EPA_success_early_down": "On Early Downs",
    "EPA_success_early_down_pass": "Successful Passes (Rate)",
    "EPA_success_early_down_rush": "Successful Rushes (Rate)",
    "early_downs": "Plays",
    "early_down_pass": "Passes",
    "early_down_rush": "Rushes",
    "EPA_success_late_down": "On Late Downs",
    "EPA_success_late_down_pass": "Successful Passes (Rate)",
    "EPA_success_late_down_rush": "Successful Rushes (Rate)",
    "late_downs": "Plays",
    "late_down_pass": "Passes",
    "late_down_rush": "Rushes",
    "middle_8": "Plays",
    "middle_8_pass": "Passes",
    "middle_8_rush": "Rushes",
    "EPA_middle_8": "EPA",
    "EPA_middle_8_success": "During \"Middle 8\"",
    "EPA_middle_8_success_pass": "Successful Passes (Rate)",
    "EPA_middle_8_success_rush": "Successful Rushes (Rate)",
    "EPA_middle_8_per_play" : "EPA/play",
    "EPA_early_down" : "EPA",
    "EPA_early_down_per_play" : "EPA/Play",
    "EPA_late_down" : "EPA",
    "EPA_late_down_per_play" : "EPA/Play",
    "late_down_avg_distance" : "Avg Distance",
    "early_down_first_down" : "First Downs Created",
};

function getMetricTitle(rowKey: string): string {
    const splitKeys = rowKey.split(".");
    const item = splitKeys.length > 1 ? splitKeys.slice(1).join(".") : splitKeys[0];

    return V2_METRIC_KEY_TITLE_MAPPING_OVERRIDES[item] || METRIC_KEY_TITLE_MAPPING[item] || item;
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