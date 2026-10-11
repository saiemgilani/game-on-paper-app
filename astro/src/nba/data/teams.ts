import type { Shot } from "./shots";

export interface Team {
  /** stats.nba.com team id; stable across relocations and renames. */
  team_id: number;
  /** The season's own tricode comes from the shots file; this is the current one. */
  tricode: string;
  /** The current name; `teamName` gives the name a team had in a given season. */
  name: string;
  /** Primary colour, for marks and accents. */
  color: string;
  /** ESPN team id, the key in the espn_nba_* releases (logos, rosters). */
  espn_id: number;
}

export const NETS_TEAM_ID = 1610612751;

// ponytail: current colours for every season; former names come from FORMER_NAMES below.
export const TEAMS: readonly Team[] = [
  { team_id: 1610612737, tricode: "ATL", name: "Atlanta Hawks", color: "#E03A3E", espn_id: 1 },
  { team_id: 1610612738, tricode: "BOS", name: "Boston Celtics", color: "#007A33", espn_id: 2 },
  { team_id: 1610612751, tricode: "BKN", name: "Brooklyn Nets", color: "#000000", espn_id: 17 },
  { team_id: 1610612766, tricode: "CHA", name: "Charlotte Hornets", color: "#1D1160", espn_id: 30 },
  { team_id: 1610612741, tricode: "CHI", name: "Chicago Bulls", color: "#CE1141", espn_id: 4 },
  { team_id: 1610612739, tricode: "CLE", name: "Cleveland Cavaliers", color: "#860038", espn_id: 5 },
  { team_id: 1610612742, tricode: "DAL", name: "Dallas Mavericks", color: "#00538C", espn_id: 6 },
  { team_id: 1610612743, tricode: "DEN", name: "Denver Nuggets", color: "#0E2240", espn_id: 7 },
  { team_id: 1610612765, tricode: "DET", name: "Detroit Pistons", color: "#C8102E", espn_id: 8 },
  { team_id: 1610612744, tricode: "GSW", name: "Golden State Warriors", color: "#1D428A", espn_id: 9 },
  { team_id: 1610612745, tricode: "HOU", name: "Houston Rockets", color: "#CE1141", espn_id: 10 },
  { team_id: 1610612754, tricode: "IND", name: "Indiana Pacers", color: "#002D62", espn_id: 11 },
  { team_id: 1610612746, tricode: "LAC", name: "LA Clippers", color: "#C8102E", espn_id: 12 },
  { team_id: 1610612747, tricode: "LAL", name: "Los Angeles Lakers", color: "#552583", espn_id: 13 },
  { team_id: 1610612763, tricode: "MEM", name: "Memphis Grizzlies", color: "#5D76A9", espn_id: 29 },
  { team_id: 1610612748, tricode: "MIA", name: "Miami Heat", color: "#98002E", espn_id: 14 },
  { team_id: 1610612749, tricode: "MIL", name: "Milwaukee Bucks", color: "#00471B", espn_id: 15 },
  { team_id: 1610612750, tricode: "MIN", name: "Minnesota Timberwolves", color: "#0C2340", espn_id: 16 },
  { team_id: 1610612740, tricode: "NOP", name: "New Orleans Pelicans", color: "#0C2340", espn_id: 3 },
  { team_id: 1610612752, tricode: "NYK", name: "New York Knicks", color: "#006BB6", espn_id: 18 },
  { team_id: 1610612760, tricode: "OKC", name: "Oklahoma City Thunder", color: "#007AC1", espn_id: 25 },
  { team_id: 1610612753, tricode: "ORL", name: "Orlando Magic", color: "#0077C0", espn_id: 19 },
  { team_id: 1610612755, tricode: "PHI", name: "Philadelphia 76ers", color: "#006BB6", espn_id: 20 },
  { team_id: 1610612756, tricode: "PHX", name: "Phoenix Suns", color: "#1D1160", espn_id: 21 },
  { team_id: 1610612757, tricode: "POR", name: "Portland Trail Blazers", color: "#E03A3E", espn_id: 22 },
  { team_id: 1610612758, tricode: "SAC", name: "Sacramento Kings", color: "#5A2D81", espn_id: 23 },
  { team_id: 1610612759, tricode: "SAS", name: "San Antonio Spurs", color: "#C4CED4", espn_id: 24 },
  { team_id: 1610612761, tricode: "TOR", name: "Toronto Raptors", color: "#CE1141", espn_id: 28 },
  { team_id: 1610612762, tricode: "UTA", name: "Utah Jazz", color: "#002B5C", espn_id: 26 },
  { team_id: 1610612764, tricode: "WAS", name: "Washington Wizards", color: "#002B5C", espn_id: 27 },
];

const BY_ID = new Map(TEAMS.map((t) => [t.team_id, t]));

/**
 * Names a franchise used before its current one, with the tricode the release files use for it and
 * the last season (end year) it applied. Per team, entries are in season order; the first one whose
 * `through` is at or after the season wins, else the current name. Seasons 1998+ (the site's range);
 * checked against the release tricodes, which change in the same seasons.
 */
export const FORMER_NAMES: readonly { team_id: number; tricode: string; through: number; name: string }[] = [
  { team_id: NETS_TEAM_ID, tricode: "NJN", through: 2012, name: "New Jersey Nets" },
  { team_id: 1610612763, tricode: "VAN", through: 2001, name: "Vancouver Grizzlies" },
  { team_id: 1610612760, tricode: "SEA", through: 2008, name: "Seattle SuperSonics" },
  { team_id: 1610612766, tricode: "CHH", through: 2002, name: "Charlotte Hornets" },
  { team_id: 1610612766, tricode: "CHA", through: 2014, name: "Charlotte Bobcats" },
  { team_id: 1610612740, tricode: "NOH", through: 2005, name: "New Orleans Hornets" },
  { team_id: 1610612740, tricode: "NOK", through: 2007, name: "New Orleans/Oklahoma City Hornets" },
  { team_id: 1610612740, tricode: "NOH", through: 2013, name: "New Orleans Hornets" },
  { team_id: 1610612746, tricode: "LAC", through: 2015, name: "Los Angeles Clippers" },
];

export function teamById(teamId: number): Team | undefined {
  return BY_ID.get(teamId);
}

/** The team's name in a season (end year): "New Jersey Nets" through 2012, "Brooklyn Nets" after. */
export function teamName(teamId: number, season: number): string | undefined {
  return FORMER_NAMES.find((f) => f.team_id === teamId && season <= f.through)?.name ?? BY_ID.get(teamId)?.name;
}

/** The franchise a tricode of any listed season belongs to (NJN and BKN are both the Nets). */
export function franchiseOf(tricode: string): number | undefined {
  return (TEAMS.find((t) => t.tricode === tricode) ?? FORMER_NAMES.find((f) => f.tricode === tricode))?.team_id;
}

/** The season's teams as they appear in its shots, with that season's tricode and name. Sorted by tricode. */
export function teamsFromShots(shots: Shot[], season: number): Team[] {
  const seen = new Map<number, string>();
  for (const s of shots) if (!seen.has(s.team_id)) seen.set(s.team_id, s.team_tricode);
  return [...seen]
    .map(([team_id, tricode]) => {
      const known = BY_ID.get(team_id);
      return known ? { ...known, tricode, name: teamName(team_id, season) ?? known.name } : { team_id, tricode, name: tricode, color: "#888888", espn_id: 0 };
    })
    .sort((a, b) => a.tricode.localeCompare(b.tricode));
}

