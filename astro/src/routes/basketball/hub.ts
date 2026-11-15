/**
 * Page-side step of BB-G47's league hub (/<league> behind 'bball-hub'): ESPN's current day through the scoreboard's own
 * prepare (same read, same cache policy, the default college group), each game's market line from game_lines, and the page
 * index. The template is components/routes/BasketballHubRoute.astro.
 *
 * Extension points: BB-G48 ("Tonight": standouts, the most dramatic games) and BB-G49 (snapshots, matchup predictor, follow a
 * team) add their own fields to BasketballHubParams and their own sections to the template; nothing here needs to change.
 */
import type { AstroGlobal } from 'astro';
import { prepareBasketballScoreboard, type BasketballScoreboardParams } from './scoreboard';
import { retrieveGameLines } from '../../resources/gameLines';
import { hubIndex, hubLine, type HubLine, type HubLink } from '../../basketball/hub';
import { cleanAbbreviation } from '../../utils/misc';
import type { BasketballLeague } from '../../utils/league';

export interface BasketballHubParams {
    board: BasketballScoreboardParams;
    /** ESPN game id -> its line; a game without one is absent */
    lines: Record<string, HubLine>;
    index: HubLink[];
}

export async function prepareBasketballHub(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballHubParams> {
    const board = await prepareBasketballScoreboard(Astro, league, { today: true });
    // `today` sends no ?date= or ?group=, the only inputs a bad-date answer comes from
    if ('badDate' in board) throw new Error(`${league} hub: the scoreboard refused its own current day`);
    const games = board.games.filter((g) => g.season?.year != null).map((g) => ({ id: g.id, season: g.season.year }));
    const rows = games.length ? await retrieveGameLines(league, games) : new Map();
    const lines: Record<string, HubLine> = {};
    for (const g of board.games) {
        const comp = g.competitions[0];
        const side = (ha: string) => comp.competitors.find((c) => c.homeAway === ha)!;
        const home = side('home'), away = side('away');
        const done = (comp.status ?? g.status)?.type?.completed === true;
        const hs = Number(home.score ?? 0), as = Number(away.score ?? 0);
        const line = hubLine(rows.get(g.id), { home: cleanAbbreviation(home.team), away: cleanAbbreviation(away.team) }, done && hs !== as ? (hs > as ? 'home' : 'away') : null);
        if (line) lines[g.id] = line;
    }
    return { board, lines, index: hubIndex(league) };
}
