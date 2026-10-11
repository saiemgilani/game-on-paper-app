/** The one place numbers become text, on pages and in charts. */

/** 0.4631 -> "46.3%"; null -> "n/a". */
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(digits)}%`;

/** Signed percentage points from a fraction: 0.042 -> "+4.2", -0.042 -> "−4.2". */
export const fmtPts = (v: number) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v * 100).toFixed(1)}`;

/** 1234 -> "1,234". */
export const fmtInt = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : Math.round(v).toLocaleString("en-US"));

/** 32.46 -> "32.5". */
export const fmtDec = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "n/a" : v.toFixed(digits));

/** "2025-11-07" -> "Nov 7" (UTC, so the date never shifts by timezone). */
export const fmtDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Case- and accent-folded text for search boxes: "Dëmin" matches "demin". */
export const foldText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
