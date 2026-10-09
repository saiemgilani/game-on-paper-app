/**
 * What a chart draw depends on besides its data (blazing's useChartFrame, as a Svelte action):
 * the <svg>'s CSS width (0 until measured; the first measurement applies at once, later ones
 * are debounced), the colour scheme (charts read the resolved theme from CSS, so a flip just
 * redraws), and whether this is the first draw (only that one animates). The draw function is
 * the action's parameter: Svelte calls `update` when a $derived draw changes, which is how a
 * data or mode change reaches the chart.
 */
import type { Action } from 'svelte/action';
import { debounce } from '../../nba/debounce';

export const RESIZE_DEBOUNCE_MS = 150;

export type Draw = (svg: SVGSVGElement, width: number, animate: boolean) => (() => void) | void;

export const chartFrame: Action<SVGSVGElement, Draw> = (node, draw) => {
    let current = draw;
    let width = 0;
    let first = true;
    let cleanup: (() => void) | void;
    const run = () => {
        if (cleanup) cleanup();
        cleanup = undefined;
        if (!width) return;
        cleanup = current(node, width, first);
        first = false;
    };
    let measured = false;
    const later = debounce((w: number) => { width = w; run(); }, RESIZE_DEBOUNCE_MS);
    const observer = new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (!measured) {
            measured = true;
            width = w;
            run();
        } else later(w);
    });
    observer.observe(node);
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => run();
    query.addEventListener('change', onScheme);
    return {
        update(next: Draw) {
            current = next;
            run();
        },
        destroy() {
            observer.disconnect();
            later.cancel();
            query.removeEventListener('change', onScheme);
            if (cleanup) cleanup();
        },
    };
};
