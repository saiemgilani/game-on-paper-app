import {LineController, type UpdateMode, Chart, type Plugin} from "chart.js";

export class GradientFillLineController extends LineController {
    update(mode: UpdateMode): void {
        for (const dataset of this.chart.data.datasets) {
            // get the min and max values
            const min = Math.min.apply(null, dataset.data as number[]);
            const max = Math.max.apply(null, dataset.data as number[]);
            const yScale = this.getScaleForId("y")
            if (!yScale) {
                return
            }

            // figure out the pixels for these and the value 0
            const top = yScale?.getPixelForValue(max) ?? 900;
            const zero = yScale?.getPixelForValue(0) ?? 450;
            const bottom = yScale?.getPixelForValue(min) ?? 0 ;

            // build a gradient that switches color at the 0 point
            const ctx = this.chart.canvas.getContext("2d");
            if (!ctx) {
                return
            }

            // get the home away colors from the backgroundColor function
            let homeTeamColor = { r: 255, g: 0, b: 0 }
            let awayTeamColor = { r: 0, g: 0, b: 255 }
            // if (typeof(dataset.backgroundColor) == "function") {
                
            // }

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
        }
        return super.update(mode)
    }
}
