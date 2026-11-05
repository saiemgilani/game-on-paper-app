/**
 * The scatter view's metric whitelist and point shape. No data-layer imports, so the browser
 * bundle stays free of the release reader; lib/data/scatter.ts builds the points on the server.
 */

export const SCATTER_METRICS = ["ptsPg", "fgaPg", "min", "fgPct", "efgPct", "fg3Pct", "tsPct", "usgPct"] as const;
export type ScatterMetric = (typeof SCATTER_METRICS)[number];

/**
 * BB-G10 ('bball-impact-scatter'): the player view's impact axes, `player_impact`'s RAPM and SPM families (NBA/WNBA).
 * Never read: o_adj_rapm / d_adj_rapm (an offset of about +11 / -11 per 100). Left out until the producer's are checked:
 * adj_rapm, the BPM family and WAR, which are not centred among rotation players (2025-26, 2,000+ offensive possessions:
 * every dbpm above zero, WAR up to 24.9).
 */
export const IMPACT_METRICS = ["oRapm", "dRapm", "rapm", "ospm", "dspm", "spm"] as const;
/** The producer column behind each impact axis. */
export const IMPACT_COLUMNS: Record<(typeof IMPACT_METRICS)[number], string> = {
  oRapm: "o_rapm", dRapm: "d_rapm", rapm: "rapm", ospm: "ospm", dspm: "dspm", spm: "spm",
};
/** BB-G10: the team view's axes, `team_strength`'s columns (its rates are team_season_rates' `all` split). */
export const TEAM_METRICS = ["adjOffRtg", "adjDefRtg", "adjNetRtg", "offRtg", "defRtg", "netRtg", "pace", "efgPctT", "tovPct", "orbPct", "ftRate", "oppEfgPct", "oppTovPct", "sos"] as const;
export const TEAM_COLUMNS: Record<(typeof TEAM_METRICS)[number], string> = {
  adjOffRtg: "adj_off_rtg", adjDefRtg: "adj_def_rtg", adjNetRtg: "adj_net_rtg", offRtg: "off_rtg", defRtg: "def_rtg", netRtg: "net_rtg", pace: "pace",
  efgPctT: "efg_pct", tovPct: "tov_pct", orbPct: "orb_pct", ftRate: "ft_rate", oppEfgPct: "opp_efg_pct", oppTovPct: "opp_tov_pct", sos: "sos",
};
/** Every axis, in the order of a point's `v`: a shooting point's `v` is the first eight, so it is unchanged. */
export const AXIS_METRICS = [...SCATTER_METRICS, ...IMPACT_METRICS, ...TEAM_METRICS] as const;
export type AxisMetric = (typeof AXIS_METRICS)[number];

/** `invert`: lower is better, so the axis runs the other way and better is still up and to the right. */
export const SCATTER_INFO: Record<AxisMetric, { label: string; pct: boolean; invert?: true }> = {
  ptsPg: { label: "PTS/g", pct: false },
  fgaPg: { label: "FGA/g", pct: false },
  min: { label: "MIN/g", pct: false },
  fgPct: { label: "FG%", pct: true },
  efgPct: { label: "eFG%", pct: true },
  fg3Pct: { label: "3P%", pct: true },
  tsPct: { label: "TS%", pct: true },
  usgPct: { label: "USG%", pct: true },
  oRapm: { label: "O-RAPM", pct: false },
  dRapm: { label: "D-RAPM", pct: false },
  rapm: { label: "RAPM", pct: false },
  ospm: { label: "O-SPM", pct: false },
  dspm: { label: "D-SPM", pct: false },
  spm: { label: "SPM", pct: false },
  adjOffRtg: { label: "Adj. off rating", pct: false },
  adjDefRtg: { label: "Adj. def rating (reversed)", pct: false, invert: true },
  adjNetRtg: { label: "Adj. net rating", pct: false },
  offRtg: { label: "Off rating", pct: false },
  defRtg: { label: "Def rating (reversed)", pct: false, invert: true },
  netRtg: { label: "Net rating", pct: false },
  pace: { label: "Pace", pct: false },
  efgPctT: { label: "eFG%", pct: true },
  tovPct: { label: "TOV% (reversed)", pct: true, invert: true },
  orbPct: { label: "ORB%", pct: true },
  ftRate: { label: "FT rate", pct: false },
  oppEfgPct: { label: "Opp eFG% (reversed)", pct: true, invert: true },
  oppTovPct: { label: "Opp TOV%", pct: true },
  sos: { label: "Strength of schedule", pct: false },
};

export const SCATTER_DEFAULT = { x: "ptsPg", y: "efgPct" } as const satisfies Record<"x" | "y", ScatterMetric>;
/** BB-G10's defaults: offense across, defense up, the medians splitting the plot into four quadrants. */
export const IMPACT_DEFAULT = { x: "oRapm", y: "dRapm" } as const satisfies Record<"x" | "y", AxisMetric>;
export const TEAM_DEFAULT = { x: "adjOffRtg", y: "adjDefRtg" } as const satisfies Record<"x" | "y", AxisMetric>;

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

export function pointValue(p: Pick<ScatterPoint, "v">, metric: AxisMetric): number | null {
  return p.v[AXIS_METRICS.indexOf(metric)] ?? null;
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
export function randomPair<M extends AxisMetric = ScatterMetric>(rand: () => number = Math.random, metrics: readonly M[] = SCATTER_METRICS as readonly AxisMetric[] as readonly M[]): [M, M] {
  const n = metrics.length;
  const i = Math.floor(rand() * n) % n;
  const j = (i + 1 + (Math.floor(rand() * (n - 1)) % (n - 1))) % n;
  return [metrics[i], metrics[j]];
}

/** ESPN's resizing endpoint for the same headshot path: faces are drawn ~26 px wide, not 350. */
export function smallHeadshot(href: string, width = 96): string {
  // The path of an absolute href (a relative one is already a path): a string op, so it cannot throw.
  const path = href.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, "").split(/[?#]/)[0];
  return `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(path)}&w=${width}&h=${Math.round((width * 254) / 350)}`;
}
