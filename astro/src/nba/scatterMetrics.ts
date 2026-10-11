/**
 * The scatter view's metric whitelist and point shape. No data-layer imports, so the browser
 * bundle stays free of the release reader; lib/data/scatter.ts builds the points on the server.
 */

export const SCATTER_METRICS = ["ptsPg", "fgaPg", "min", "fgPct", "efgPct", "fg3Pct", "tsPct", "usgPct"] as const;
export type ScatterMetric = (typeof SCATTER_METRICS)[number];

export const SCATTER_INFO: Record<ScatterMetric, { label: string; pct: boolean }> = {
  ptsPg: { label: "PTS/g", pct: false },
  fgaPg: { label: "FGA/g", pct: false },
  min: { label: "MIN/g", pct: false },
  fgPct: { label: "FG%", pct: true },
  efgPct: { label: "eFG%", pct: true },
  fg3Pct: { label: "3P%", pct: true },
  tsPct: { label: "TS%", pct: true },
  usgPct: { label: "USG%", pct: true },
};

export const SCATTER_DEFAULT = { x: "ptsPg", y: "efgPct" } as const satisfies Record<"x" | "y", ScatterMetric>;

export interface ScatterPoint {
  person_id: number;
  name: string;
  team_id: number;
  team: string;
  /** Team colour from the static team map. */
  color: string;
  nets: boolean;
  headshot: string | null;
  /** One value per SCATTER_METRICS entry, in that order (half the payload of keyed objects). */
  v: (number | null)[];
}

export function pointValue(p: Pick<ScatterPoint, "v">, metric: ScatterMetric): number | null {
  return p.v[SCATTER_METRICS.indexOf(metric)] ?? null;
}

/** The name a dot is labelled with: the surname, skipping generational suffixes ("Porter", not "Jr."). */
export function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  while (parts.length > 1 && /^(jr|sr|ii|iii|iv|v)\.?$/i.test(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1];
}

/**
 * Dot labels: the surname, or first initial and surname when two or more of `names` share it
 * (eleven plotted Williamses would otherwise all read "Williams").
 */
export function dotLabels(names: string[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const n of names) count.set(surname(n), (count.get(surname(n)) ?? 0) + 1);
  return new Map(
    names.map((n) => {
      const last = surname(n);
      const first = n.trim().split(/\s+/)[0];
      return [n, (count.get(last) ?? 0) > 1 && first && first !== last ? `${first[0]}. ${last}` : last];
    }),
  );
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Two different metrics, for the "Random" button. */
export function randomPair(rand: () => number = Math.random): [ScatterMetric, ScatterMetric] {
  const n = SCATTER_METRICS.length;
  const i = Math.floor(rand() * n) % n;
  const j = (i + 1 + (Math.floor(rand() * (n - 1)) % (n - 1))) % n;
  return [SCATTER_METRICS[i], SCATTER_METRICS[j]];
}

/** ESPN's resizing endpoint for the same headshot path: faces are drawn ~26 px wide, not 350. */
export function smallHeadshot(href: string, width = 96): string {
  // The path of an absolute href (a relative one is already a path): a string op, so it cannot throw.
  const path = href.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, "").split(/[?#]/)[0];
  return `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(path)}&w=${width}&h=${Math.round((width * 254) / 350)}`;
}
