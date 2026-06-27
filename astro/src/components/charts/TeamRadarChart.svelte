<script lang="ts">
import Chart from 'chart.js/auto'
import type { ChartItem } from "chart.js";
import { waitForElement, cleanLocation } from "../../utils/misc";
import { generateRadarConfig, generateRadarDataset } from '../../utils/radar';

const { team, teamData } = $props();
let season = $state(teamData[0].season)

let offRadarChart: Chart | null = null;
let defRadarChart: Chart | null = null;

async function waitToGenerateChart() {
    try {
        const selectedTeamData = teamData.filter((p: any) => parseInt(p.season) == parseInt(season))

        const offRadarCtx = await waitForElement(document, "offensive-canvas");
        const defRadarCtx = await waitForElement(document, "defensive-canvas");

        if (offRadarChart) {
            offRadarChart?.destroy()
        }

        offRadarChart = new Chart(
            offRadarCtx as ChartItem,
            generateRadarConfig(
                generateRadarDataset(selectedTeamData, "Offensive"),
                `${cleanLocation(team)} ${season} Offensive Profile`
            )
        );


        if (defRadarChart) {
            defRadarChart?.destroy()
        }

        defRadarChart = new Chart(
            defRadarCtx as ChartItem,
            generateRadarConfig(
                generateRadarDataset(selectedTeamData, "Defensive"),
                `${cleanLocation(team)} ${season} Defensive Profile`
            )
        );

    } catch (e) {
        console.error(e);
        const container = document.getElementById(`radar_container`);
        if (container) {
            container.innerHTML = `<div class="col-12"><p class='m-0 mb-3 text-muted text-small'>Unable to generate charts. Please reach out to <a href="https://twitter.com/akeaswaran">@akeaswaran</a> or <a href="https://twitter.com/saiemgilani">@saiemgilani</a> on Bluesky with the page and chart options you're trying to access.</p></div>`
        }
    }
}

if (document.readyState !== 'loading') {
    console.log(`DOM ready state`)
    waitToGenerateChart()
} else {
    document.addEventListener('DOMContentLoaded', () => {
        console.log(`DOM content loaded state`)
        waitToGenerateChart()
    })
}

function onChangeValue(e: Event) {
    season = parseInt(e.target.value)
    waitToGenerateChart()
}

</script>


<div class="container">
    <div class="row mb-3">
        <div class="col-lg-6 col-xs-12">
            <h2 class="d-inline">Profile History</h2>
            <p class="text-small text-muted">Data shown is from FBS vs FBS games only. Based on <a href="https://twitter.com/ESPN_BillC">Bill Connelly</a>'s team profile radars (<a href="https://www.sbnation.com/college-football/2018/7/16/17532360/georgia-tech-football-2018-preview-schedule-roster">example</a>).</p>
        </div>
        <div class="ms-auto col-lg-2 col-xs-12">
            <select class="form-select form-select-md" onchange={onChangeValue}>
				<option value="-1" disabled>Choose Season...</option>
				{#each teamData as t}
					<option value={t.season} selected={(season == t.season)}>{t.season}</option>
				{/each}
            </select>
        </div>
    </div>
    <div class="row mb-3" id="radar_container">
        <div class="col-lg-6 col-xs-12 mb-xs-3">
            <canvas id="offensive-canvas" style="display: block; box-sizing: border-box; height: 200px; width: 200px;" width="400px" height="400px"></canvas>
        </div>
        <div class="col-lg-6 col-xs-12 mb-xs-3">
            <canvas id="defensive-canvas" style="display: block; box-sizing: border-box; height: 200px; width: 200px;" width="400px" height="400px"></canvas>
        </div>
    </div>
</div>