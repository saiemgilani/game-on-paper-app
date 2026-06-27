<script lang="ts">
import Chart from 'chart.js/auto'
import type { ChartItem } from "chart.js";
import { waitForElement, cleanLocation } from "../../utils/misc";
import { generateRadarConfig, generateRadarDataset } from '../../utils/radar';

const { homeTeam, awayTeam, teamData } = $props();

let offRadarChart: Chart | null = null;
let defRadarChart: Chart | null = null;

async function waitToGenerateChart() {
    try {
        const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

        const offRadarCtx = await waitForElement(document, "offensive-canvas");
        const defRadarCtx = await waitForElement(document, "defensive-canvas");

        if (offRadarChart) {
            offRadarChart?.destroy()
        }

        offRadarChart = new Chart(
            offRadarCtx as ChartItem,
            generateRadarConfig(
                generateRadarDataset(teamData, "Offensive", "Defensive", isDarkMode),
                `${cleanLocation(awayTeam)} Offense vs ${cleanLocation(homeTeam)} Defense`,
                isDarkMode,
                true
            )
        );


        if (defRadarChart) {
            defRadarChart?.destroy()
        }

        defRadarChart = new Chart(
            defRadarCtx as ChartItem,
            generateRadarConfig(
                generateRadarDataset(teamData, "Defensive", "Offensive", isDarkMode),
                `${cleanLocation(awayTeam)} Defense vs ${cleanLocation(homeTeam)} Offense`,
                isDarkMode,
                true
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

</script>

<div class="row mb-3" id="radar_container">
    <div class="col-lg-6 col-xs-12 mb-xs-3">
        <canvas id="offensive-canvas" style="display: block; box-sizing: border-box; height: 200px; width: 200px;" width="200px" height="200px"></canvas>
    </div>
    <div class="col-lg-6 col-xs-12 mb-xs-3">
        <canvas id="defensive-canvas" style="display: block; box-sizing: border-box; height: 200px; width: 200px;" width="200px" height="200px"></canvas>
    </div>
</div>