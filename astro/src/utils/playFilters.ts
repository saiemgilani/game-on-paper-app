/**
 * Row pairing for the All Plays quarter filter.
 *
 * An expandable play is TWO table rows: the summary, and the collapsed detail
 * that Bootstrap toggles. Filtering or reordering has to move them together, or
 * a detail row ends up under a play it does not belong to.
 *
 * Kept out of the component so it can be tested without a DOM.
 */

/**
 * Group consecutive rows into `[summary]` or `[summary, detail]` runs.
 *
 * A detail row attaches to the summary before it. A leading detail row -- which
 * should never happen, but would silently mis-pair every row after it -- starts
 * its own group rather than being dropped.
 */
export function pairRows<T>(rows: T[], isDetail: (row: T) => boolean): T[][] {
    const pairs: T[][] = [];
    for (const row of rows) {
        if (isDetail(row) && pairs.length) pairs[pairs.length - 1].push(row);
        else pairs.push([row]);
    }
    return pairs;
}
