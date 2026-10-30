import {LineController, type UpdateMode, Chart, type Plugin} from "chart.js";
import { color } from "chart.js/helpers";

// The grid-line colour every Chart.js axis on the site shares: the theme's text colour (`ink`, the
// canvas's computed `color`), faded. 0.3 on white reads as a grid line; 0.2 on the dark background keeps
// the grid quiet under the brighter axis lines.
export function chartGridColor(ink: string, dark: boolean): string {
    return color(ink).alpha(dark ? 0.2 : 0.3).rgbString();
}

type GridContext = { tick?: { value?: number } };

// An axis's grid with its zero line drawn bold: the same ink at 0.75 and twice the width. The charts kept a
// fixed #AAAAAA/#ACACAC zero line when #339 moved the grid to chartGridColor, which on white (#BCBEBF) is
// nearly as dark, so the zero line disappeared into the grid.
export function chartGridLines(ink: string, dark: boolean) {
    const grid = chartGridColor(ink, dark);
    const zero = color(ink).alpha(0.75).rgbString();
    return {
        color: (c: GridContext) => (c.tick?.value === 0 ? zero : grid),
        lineWidth: (c: GridContext) => (c.tick?.value === 0 ? 2 : 1),
    };
}

export interface ValuePercentile {
    season: number
    pctile: number
    value: number
}

export interface ValueDistribution {
    min: number | null,
    q1: number | null
    median: number | null
    q3: number | null
    max: number | null
}

export class GradientFillLineController extends LineController {
    update(mode: UpdateMode): void {
        for (const dataset of this.chart.data.datasets) {
            // get the min and max values
            const min = Math.min.apply(null, dataset.data as number[]);
            const max = Math.max.apply(null, dataset.data as number[]);
            const yScale = this.chart.scales.y
            if (!yScale) {
                console.error("no y scale")
                return
            }

            // figure out the pixels for these and the value 0
            const top = yScale.getPixelForValue(max);
            const zero = yScale.getPixelForValue(0);
            const bottom = yScale.getPixelForValue(min);

            // build a gradient that switches color at the 0 point
            const ctx = this.chart.ctx;
            if (!ctx) {
                console.error("no chart context")
                return
            }

            if (typeof(dataset.hoverBorderColor) == "string" && dataset.hoverBorderColor.includes("\"r\":")) {
                // get the home away colors from the backgroundColor function
                console.log("setting gradient")
                console.log(dataset.hoverBorderColor)
                console.log(dataset.hoverBackgroundColor)

                const homeTeamColor = JSON.parse((dataset.hoverBorderColor as string));
                const awayTeamColor = JSON.parse((dataset.hoverBackgroundColor as string));

                ctx.save()
                const gradientFill = ctx.createLinearGradient(0, top, 0, bottom);
                const gradientStroke = ctx.createLinearGradient(0, top, 0, bottom);
                let ratio = Math.min((zero - top) / (bottom - top), 1);
                if (ratio < 0) {
                    ratio = 0;
                    gradientFill.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`);

                    gradientStroke.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`);
                } else if (ratio == 1) {
                    gradientFill.addColorStop(1, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`);

                    gradientStroke.addColorStop(1, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`);
                } else {
                    gradientFill.addColorStop(0, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`);
                    gradientFill.addColorStop(ratio, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 0.5)`);
                    gradientFill.addColorStop(ratio, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`);
                    gradientFill.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 0.5)`);

                    gradientStroke.addColorStop(0, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`);
                    gradientStroke.addColorStop(ratio, `rgba(${homeTeamColor.r},${homeTeamColor.g},${homeTeamColor.b}, 1.0)`);
                    gradientStroke.addColorStop(ratio, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`);
                    gradientStroke.addColorStop(1, `rgba(${awayTeamColor.r},${awayTeamColor.g},${awayTeamColor.b}, 1.0)`);
                }

                dataset.backgroundColor = gradientFill;
                dataset.borderColor = gradientStroke;
                dataset.hoverBackgroundColor = gradientStroke;
                dataset.hoverBorderColor = gradientStroke;

                ctx.restore();
            } else {
                console.log("no gradient")
                console.log(dataset.hoverBorderColor)
                console.log(dataset.hoverBackgroundColor)
            }
        }
        return super.update(mode)
    }
}

