/**
 * Sprite atlas for canvas scatters (roadmap F14): pack 130+ team logos or ~500 headshots into one canvas, so a
 * scatter draws from a single image instead of hundreds of `<img>`s. Sources come from `teamLogoSrc` /
 * `headshotSrc` (utils/league.ts): ESPN's CORS-open CDN and its combiner resizer, so images loaded with
 * `crossOrigin="anonymous"` draw without tainting the canvas (PNG export keeps working). The atlas is built in the
 * viewer's browser and republishes no ESPN pixels, the same posture as today's hotlinked `<img>`.
 *
 * Twin of sportsdataverse-web `frontend/lib/platform/spriteAtlas.ts` (same `packFrames` / `buildAtlas`, including
 * its cols guard and its `defineProperty` frame write). Only `buildAtlas` touches the DOM. Nothing imports this yet:
 * S4 adopts it behind its own flag.
 */

export type Frame = { x: number; y: number; w: number; h: number };

/** Row-major grid of `cell`-px squares, `cols` wide; a duplicate id keeps its first slot.
 *  `cols` below 1 would give NaN/Infinity frames silently, so it throws. */
export function packFrames(ids: string[], cell: number, cols: number): Record<string, Frame> {
    if (!(cols >= 1)) throw new RangeError('packFrames: cols must be >= 1');
    const frames: Record<string, Frame> = {};
    let i = 0;
    for (const id of ids) {
        if (Object.hasOwn(frames, id)) continue;
        // defineProperty: a plain `frames[id] =` with id "__proto__" would set the prototype, not a frame
        Object.defineProperty(frames, id, {
            value: { x: (i % cols) * cell, y: Math.floor(i / cols) * cell, w: cell, h: cell },
            enumerable: true, writable: true, configurable: true,
        });
        i++;
    }
    return frames;
}

/** Images in flight at once: a 500-face build must not open every request at once (the CDN takes a burst badly). */
const IN_FLIGHT = 16;

/**
 * Browser-only. Loads every `src` with `crossOrigin="anonymous"`, IN_FLIGHT at a time, and draws them into a
 * `packFrames` grid (`cols = ceil(sqrt(n))`) on one canvas. Each image keeps its aspect, scaled down only if it
 * overflows the cell. An image that fails to load is dropped from `frames` (the consumer draws a dot for it); its
 * cell stays an empty hole.
 */
export async function buildAtlas(
    entries: { id: string; src: string }[],
    cell: number,
): Promise<{ canvas: HTMLCanvasElement; frames: Record<string, Frame> }> {
    const cols = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
    const frames = packFrames(entries.map((e) => e.id), cell, cols);
    const n = Object.keys(frames).length;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(n, cols) * cell;
    canvas.height = Math.ceil(n / cols) * cell;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas context');

    const load = (src: string) =>
        new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });

    // a duplicate id keeps its first entry, as packFrames keeps its first slot
    const seen = new Set<string>();
    const todo = entries.filter(({ id }) => !seen.has(id) && seen.add(id));
    let next = 0;
    const worker = async () => {
        while (next < todo.length) {
            const { id, src } = todo[next++];
            const img = await load(src);
            const f = frames[id];
            if (!img) {
                delete frames[id];
                continue;
            }
            const s = Math.min(1, cell / img.width, cell / img.height);
            ctx.drawImage(img, f.x, f.y, img.width * s, img.height * s);
        }
    };
    await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, todo.length) }, worker));
    return { canvas, frames };
}
