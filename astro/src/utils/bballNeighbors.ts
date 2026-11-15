/**
 * BB-G12 ('bball-rank-neighbors'): the basketball nearby-rank lists, football's S3 on the basketball team pages (player
 * lists wait for a producer-ranked player table with a minimum). The window (`neighborWindow`, within five places of the page's own rank) and the shading (`metricShade`, the
 * leaderboards' rank ramp) are football's; this only names the metrics and formats the cells for `NeighborRanks.astro`.
 * Every rank is the producer's `<m>_rank` (resources/bballNeighbors.ts); nothing is re-ranked here.
 */
import { BASKETBALL } from '../basketball/config';
import { fmtDec, fmtPct } from '../nba/format';
import { teamHref } from '../nba/links';
import type { RankRow, TEAM_RANKED } from '../resources/bballNeighbors';
import { PRO_LEAGUES, type BasketballLeague } from './league';
import { formatRank, generateMarginalString } from './misc';
import { metricShade, neighborWindow, type NeighborList } from './neighbors';

type Spec<K extends string> = readonly [key: K, title: string, fmt: (v: number) => string];
const signed = (v: number) => generateMarginalString(v, 1, 1);
const rating = (v: number) => fmtDec(v, 1);

const TEAM: readonly Spec<(typeof TEAM_RANKED)[number]>[] = [
    ['net_rtg', 'Net rating', signed],
    ['off_rtg', 'Off rating', rating],
    ['def_rtg', 'Def rating', rating],
    ['adj_net_rtg', 'Adj. net rating', signed],
    ['efg_pct', 'eFG%', fmtPct],
    ['opp_efg_pct', 'Opp eFG%', fmtPct],
    ['pace', 'Pace', rating],
    ['tov_pct', 'TOV%', fmtPct],
    ['orb_pct', 'ORB%', fmtPct],
    ['ft_rate', 'FT rate', (v) => fmtDec(v, 3)],
    ['sos', 'SOS', signed],
    ['sov', 'SOV', signed],
];
/** Pace is the season block's: not shaded (faster is not better), and "Tempo" in college. */
const UNSHADED = new Set<string>(['pace']);

/** The team page's lists: `teamId` keys the season tables (the stats id for the NBA/WNBA, ESPN's in college). */
export function bballTeamNeighborLists(rows: RankRow[], teamId: number, league: BasketballLeague, season: number, q: string): NeighborList[] {
    const teams = BASKETBALL[league].teams;
    const known = rows.filter((r) => teams.inSeason(Number(r.team_id), season));
    const college = !PRO_LEAGUES.includes(league);
    return TEAM.map(([key, title, fmt]) => {
        const shade = UNSHADED.has(key) ? () => null : metricShade(known, key);
        return {
            metric: key,
            title: key === 'pace' && college ? 'Tempo' : title,
            rows: neighborWindow(known, (r) => String(r.team_id), teamId, key).map((n) => {
                const t = teams.inSeason(Number(n.row.team_id), season)!;
                // the key is the id the page links by; the logo goes by ESPN's id (DarkModeLogos, teamLogoUrl)
                return { key: n.key, rank: formatRank(n.rank), label: t.name, href: teamHref(t.team_id, q, league), teamId: String(t.espn_id), team: null, value: fmt(n.value), shade: shade(n.rank), self: n.self };
            }),
        };
    }).filter((l) => l.rows.length > 0);
}

