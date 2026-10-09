<script lang="ts">
import type { ProcessedBoxScore } from '../../../resources/python';
import { espnLogoLeague, leagueFromLocation } from '../../../utils/league';
import { leaguePath } from '../../../utils/league';
import { binionBoxCells } from '../../../utils/binionBox';
import type { SDVSeasonPercentile } from '../../../resources/sdv';
import { LEAGUES, type League } from '../../../utils/league';

interface Props {
    season: number
    advancedBoxScore: ProcessedBoxScore
    percentiles: SDVSeasonPercentile[]
    league?: League
    /** the SituationalSection span shown; "all" is the full game */
    span?: string
}

const {season, advancedBoxScore, percentiles, league = 'cfb', span = 'all'}: Props = $props();
// the ladder is single full games: a quarter or half shows its values unranked
const ladder = $derived(span === 'all' ? percentiles : []);
// the population the percentiles describe: "FBS vs FBS" for college, "NFL" for the pros
const percentilePool = league === 'cfb' ? `${LEAGUES.cfb.pool} vs ${LEAGUES.cfb.pool}` : LEAGUES[league].pool;
const groups = $derived(advancedBoxScore.team.map((group: any) => group.pos_team));

const slim_title_mapping: Record<string, string> = {
    "EPA_per_play" : "EPA/Play",
    "EPA_passing_per_play" : "EPA/Dropback",
    "EPA_rushing_per_play" : "EPA/Rush",
    "defensive.havoc_total" : "Havoc Rate",
    "rushing_stuff" : "Def Run Stuff Rate",
    "situational.EPA_success" : "Success Rate",
    "situational.EPA_success_rate_third" : "3rd Down Success Rate",
    "situational.EPA_success_rate_rz" : "Red Zone Success Rate",
    "EPA_explosive" : "Explosive Play Rate",
    "yards_per_pass": "Yards/Dropback",
    "yards_per_play": "Yards/Play",
}

const columns = [
    "EPA_per_play",
    "situational.EPA_success", 
    "yards_per_play",
    "EPA_passing_per_play", 
    "EPA_rushing_per_play", 
    "yards_per_pass", 
    "EPA_explosive", 
    "situational.EPA_success_rate_third", 
    "situational.EPA_success_rate_rz", 
    "rushing_stuff", 
    "defensive.havoc_total"
]
const percentileSeason = $derived(ladder.length == 0 ? season : ladder[0].season);
</script>

<div class="table-responsive">
    <table class="table table-sm table-responsive">
        <caption class="text-muted small">Concept from Robert Binion (<a href="https://twitter.com/robert_binion">@robert_binion</a>). Data from GameOnPaper.com by Akshay Easwaran (<a href="https://bsky.app/profile/akeaswaran.me">@akeaswaran.me</a>) and Saiem Gilani (<a href="https://bsky.app/profile/saiemgilani.bsky.social">@saiemgilani</a>) with kneel downs removed.
        {#if ladder.length > 0}
            <span> Cell colors reflect the percentile of a team's performance against all single-game {percentilePool} performances in that stat in {percentileSeason}.</span>
        {/if}
        </caption>
        <thead>
            <tr>
                <th style="text-align: left;">Overall</th>
                {#each groups as value}
                <th style="text-align: center;">
                    <a href={leaguePath(league, `/year/${season}/team/${value}`)}>
                        <img class={`img-fluid team-logo-${value}`} width="35px" src={`https://a.espncdn.com/i/teamlogos/${espnLogoLeague(league)}/500/${value}.png`} alt={`ESPN team id ${value}`}/>
                    </a>
                </th>
                {/each}
            </tr>
        </thead>
        <tbody>
            {#each columns as item}
            <tr>
                <td style="text-align: left;">{@html slim_title_mapping[item] || item}</td>
                {@html binionBoxCells(advancedBoxScore as any, item, ladder)}
            </tr>
            {/each}
        </tbody>
    </table>
</div>