// The 2021 site's linked visuals: hovering a distance on one chart marks it on the others in the same dashboard.
// The dashboard's wrapper carries `data-shot-link`; charts outside one (or rendered on the server) link to nothing.

const EVENT = "shot-distance";

/** Feet from the rim (null when the pointer left) and how many feet either side the hovered mark covers. */
export interface DistanceCursor {
  ft: number | null;
  band?: number;
}

type Sent = DistanceCursor & { from: Element };

/** Per dashboard: the last distance sent (so a chart that redraws picks it up) and the chart holding a pin, if any. */
interface HubState {
  last: Sent | null;
  pinnedBy: Element | null;
}
const hubs = new WeakMap<Element, HubState>();

function hubOf(el: Element): { hub: Element; state: HubState } | null {
  const hub = el.closest("[data-shot-link]");
  if (!hub) return null;
  let state = hubs.get(hub);
  if (!state) hubs.set(hub, (state = { last: null, pinnedBy: null }));
  return { hub, state };
}

/**
 * Tell the other charts in this chart's dashboard where the pointer is. `pin: true` makes this chart's distance hold
 * until it sends `pin: false`; while it holds, the other charts' hovers are ignored.
 */
export function emitDistance(from: Element, cursor: DistanceCursor, { pin }: { pin?: boolean } = {}): void {
  const found = hubOf(from);
  if (!found) return;
  const { hub, state } = found;
  // A pin left by a chart that is gone (mode switch, unmount) releases itself.
  if (state.pinnedBy && !state.pinnedBy.isConnected) state.pinnedBy = null;
  if (state.pinnedBy && state.pinnedBy !== from) return;
  if (pin !== undefined) state.pinnedBy = pin ? from : null;
  state.last = { ...cursor, from };
  hub.dispatchEvent(new CustomEvent(EVENT, { detail: state.last }));
}

/** Follow the other charts' distance, starting from the current one; returns the unsubscribe for the chart's cleanup. */
export function onDistance(el: Element, fn: (cursor: DistanceCursor) => void): () => void {
  const found = hubOf(el);
  if (!found) return () => {};
  const { hub, state } = found;
  const handler = (e: Event) => {
    const d = (e as CustomEvent<Sent>).detail;
    if (d.from !== el) fn(d);
  };
  hub.addEventListener(EVENT, handler);
  if (state.last && state.last.ft !== null && state.last.from !== el && state.last.from.isConnected) fn(state.last);
  return () => hub.removeEventListener(EVENT, handler);
}

// A bin of rounded feet [d, d + binFt) holds true distances [d - 0.5, d + binFt - 0.5): the cursor it sends, and whether a
// distance another chart sent falls in it (the bar and side charts).
/** The cursor for a distance bin starting at `d` feet, `binFt` wide. */
export const binCursor = (d: number, binFt: number): DistanceCursor => ({ ft: d + (binFt - 1) / 2, band: binFt / 2 });

/** Whether `ft` falls in the bin starting at `d` feet. */
export const inBin = (ft: number, d: number, binFt: number): boolean => ft >= d - 0.5 && ft < d + binFt - 0.5;
