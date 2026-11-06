/**
 * Page-side step of /<league>/players/[id]: blazing-the-nets' loadPlayerPage + assemblePlayerPage
 * over the Data API. Mirrors routes/player.ts: the prep is testable, the page file stays
 * short, a malformed id is a 404 before any read, the identity-bearing reads (season players,
 * league context, his shots) must succeed or the page is a 503, and the decorative reads
 * (games, his seasons) degrade and turn caching off.
 */
import type { AstroGlobal } from 'astro';
import { courtFor, placeholderFor, rankMins } from '../../basketball/config';
import { headshotsFromRows, leagueContextFromRows, playerGamesFromRows, playerSeasonsFromRows, shotsFromRows, teamsOfPlayer } from '../../nba/adapters';
import type { PlayerExplorerData } from '../nba/explorer';
import { shootingLine, type ShootingLine } from '../../nba/data/aggregate';
import { COURT } from '../../nba/data/court';
import { placeholderSplit } from '../../nba/data/placeholder';
import type { PlayerSeason } from '../../nba/data/players';
import { rankSummaries, type RankMins, type RankSummary } from '../../nba/data/ranks';
import { retrieveLeagueContextRows, retrievePlayerGameRows, retrievePlayerSeasons, retrievePlayerShots, retrieveSeasonPlayerRows } from '../../resources/nbaShots';
import type { BasketballLeague } from '../../utils/league';
import { playerCache, setCache, uncacheable } from './cache';
import { resolveBasketballSeason } from './season';

export interface BasketballPlayerParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    player: PlayerSeason;
    line: ShootingLine;
    /** Tricodes of every team he shot for, most attempts first. */
    teams: string[];
    headshot: string | null;
    prev: PlayerSeason | null;
    next: PlayerSeason | null;
    explorer: PlayerExplorerData;
    ranks: RankSummary[];
    /** the league-season's rank bars (rankMins): the NBA's 100 FGA / 50 3PA, scaled by season length */
    min: RankMins;
    /** Seasons he took a regular-season shot in (the picker); just this one when that read failed. */
    hisSeasons: number[];
    /** D29: the season's shots at the league's placeholder location, and all his shots (the page note); absent for the NBA */
    unlocated?: { count: number; total: number };
}

export type BasketballPlayerPrep = { notFound: true } | { unavailable: true } | BasketballPlayerParams;

export async function prepareBasketballPlayer(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballPlayerPrep> {
    Astro.locals.league = league;
    const id = Astro.params.id ?? '';
    if (!/^\d{1,10}$/.test(id)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const personId = Number(id);
    const resolved = resolveBasketballSeason(Astro, league);
    const { season } = resolved;

    const reads = await Promise.allSettled([
        retrieveSeasonPlayerRows(season, league),
        retrieveLeagueContextRows(season, league),
        retrievePlayerShots(season, personId, league),
        retrievePlayerGameRows(season, personId, league),
        retrievePlayerSeasons(personId, league),
    ]);
    const [playersR, contextR, shotsR, gamesR, seasonsR] = reads;
    for (const [name, r] of [['season players', playersR], ['league context', contextR], ['shots', shotsR]] as const) {
        if (r.status === 'rejected') {
            console.error(`ERROR while loading ${name} for player ${personId}, ${season}: ${r.reason}`);
            uncacheable(Astro);
            return { unavailable: true };
        }
    }
    if (playersR.status !== 'fulfilled' || contextR.status !== 'fulfilled' || shotsR.status !== 'fulfilled') return { unavailable: true };

    const rows = playersR.value;
    const players = playerSeasonsFromRows(rows);
    const player = players.find((p) => p.person_id === personId);
    if (!player) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const shots = shotsFromRows(shotsR.value);
    const context = leagueContextFromRows(contextR.value);
    const court = courtFor(league, season);
    const placeholder = placeholderFor(league, season); // R22: null after `through` and for the NBA
    const line = shootingLine(shots);
    const roster = playerSeasonsFromRows(rows, player.team_id);
    const i = roster.findIndex((p) => p.person_id === personId);

    let degraded = false;
    let games = null;
    if (gamesR.status === 'fulfilled') {
        games = playerGamesFromRows(gamesR.value);
        if (games === null) console.warn(`[player ${personId}] per-game views unavailable: a game has no log row`);
        else {
            // blazing's playerGames throws when a shot's game has no log row (the two reads are cached apart).
            const logged = new Set(games.map((g) => g.game_id));
            const missing = shots.find((s) => !logged.has(s.game_id));
            if (missing) {
                games = null;
                degraded = true; // the two reads disagree mid-rebuild: don't hold the page without its per-game views
                console.warn(`[player ${personId}] per-game views unavailable: game ${missing.game_id} has shots but no log row`);
            }
        }
    } else {
        degraded = true;
        console.error(`player ${personId}: the games read failed: ${gamesR.reason}`);
    }
    let hisSeasons = [season];
    if (seasonsR.status === 'fulfilled') hisSeasons = seasonsR.value.length ? seasonsR.value : [season];
    else {
        degraded = true;
        console.error(`player ${personId}: the seasons read failed: ${seasonsR.reason}`);
    }

    // seasonFgPct (line) still counts every shot: D29 "counted"
    const n = placeholderSplit(shots, placeholder).unlocated;
    const min = rankMins(league, season);
    if (degraded) uncacheable(Astro);
    else setCache(Astro, playerCache(league));
    return {
        ...resolved,
        player,
        line,
        teams: teamsOfPlayer(rows, personId),
        headshot: headshotsFromRows(rows).get(personId) ?? null,
        prev: i > 0 ? roster[i - 1] : null,
        next: i >= 0 && i < roster.length - 1 ? roster[i + 1] : null,
        explorer: { shots, games, league: context, seasonFgPct: line.fgPct, ...(court === COURT ? {} : { court }), ...(placeholder ? { placeholder } : {}) },
        ranks: rankSummaries(players, personId, 5, min),
        min,
        hisSeasons,
        ...(n > 0 ? { unlocated: { count: n, total: shots.length } } : {}),
    };
}
