// The 2021 site's linked visuals: hovering a distance on one chart marks it on the others in the same dashboard.
// The dashboard's wrapper carries `data-shot-link`; charts outside one (or rendered on the server) link to nothing.

const EVENT = "shot-distance";

/** Feet from the rim (null when the pointer left) and how many feet either side the hovered mark covers. */
export interface DistanceCursor {
  ft: number | null;
  band?: number;
}

/** Tell the other charts in this chart's dashboard where the pointer is. */
export function emitDistance(from: Element, cursor: DistanceCursor): void {
  from.closest("[data-shot-link]")?.dispatchEvent(new CustomEvent(EVENT, { detail: { ...cursor, from } }));
}

/** Follow the other charts' distance; returns the unsubscribe for the chart's cleanup. */
export function onDistance(el: Element, fn: (cursor: DistanceCursor) => void): () => void {
  const hub = el.closest("[data-shot-link]");
  if (!hub) return () => {};
  const handler = (e: Event) => {
    const d = (e as CustomEvent<DistanceCursor & { from: Element }>).detail;
    if (d.from !== el) fn(d);
  };
  hub.addEventListener(EVENT, handler);
  return () => hub.removeEventListener(EVENT, handler);
}
