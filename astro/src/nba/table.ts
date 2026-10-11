/** The dense roster table's state: sort, a keyboard focus cursor and the name filter. Pure. */

export type SortDir = "asc" | "desc";

export interface TableState {
  sortKey: string;
  sortDir: SortDir;
  /** Focused row (index into the displayed rows) and column (index into the sortable keys). */
  row: number;
  col: number;
}

export type TableAction =
  | { type: "sort"; key: string }
  /** `from`: the row to move from when it is not the stored cursor (the focused row after a re-sort). */
  | { type: "move"; dRow: number; dCol: number; rows: number; cols: number; from?: number }
  | { type: "sortFocused"; keys: string[] };

export function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case "sort":
      // Same column flips; a new column starts high-to-low (every column here is "more is more").
      return state.sortKey === action.key
        ? { ...state, sortDir: state.sortDir === "desc" ? "asc" : "desc" }
        : { ...state, sortKey: action.key, sortDir: "desc" };
    case "move": {
      const clamp = (v: number, n: number) => Math.max(0, Math.min(Math.max(n - 1, 0), v));
      return { ...state, row: clamp((action.from ?? state.row) + action.dRow, action.rows), col: clamp(state.col + action.dCol, action.cols) };
    }
    case "sortFocused": {
      const key = action.keys[state.col];
      return key === undefined ? state : tableReducer(state, { type: "sort", key });
    }
  }
}

/**
 * Hotkeys: j/k move the row focus, h/l the column focus, s sorts by the focused column, / jumps
 * to the search box. Keys typed into a field are not hotkeys.
 */
export function hotkey(key: string, rows: number, keys: string[]): TableAction | "search" | null {
  const cols = keys.length;
  switch (key) {
    case "j":
      return { type: "move", dRow: 1, dCol: 0, rows, cols };
    case "k":
      return { type: "move", dRow: -1, dCol: 0, rows, cols };
    case "l":
      return { type: "move", dRow: 0, dCol: 1, rows, cols };
    case "h":
      return { type: "move", dRow: 0, dCol: -1, rows, cols };
    case "s":
      return { type: "sortFocused", keys };
    case "/":
      return "search";
    default:
      return null;
  }
}

/** Sorted copy; missing values always last, ties by name. */
export function sortRows<T extends { name: string }>(rows: T[], dir: SortDir, value: (row: T) => number | null): T[] {
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return va === vb ? a.name.localeCompare(b.name) : va === null ? 1 : -1;
    return (dir === "desc" ? vb - va : va - vb) || a.name.localeCompare(b.name);
  });
}
