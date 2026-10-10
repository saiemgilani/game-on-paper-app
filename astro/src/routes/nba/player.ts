/**
 * Page-side step of /nba/players/[id]: blazing-the-nets' loadPlayerPage + assemblePlayerPage
 * over the Data API. Mirrors routes/player.ts: the prep is testable, the page file stays
 * short, a malformed id is a 404 before any read, the identity-bearing reads (season players,
 * league context, his shots) must succeed or the page is a 503, and the decorative reads
 * (games, his seasons) degrade and turn caching off.
 */
import type { AstroGlobal } from 'astro';
import { headshotsFromRows, leagueContextFromRows, playerGamesFromRows, playerSeasonsFromRows, shotsFromRows, teamsOfPlayer } from '../../nba/adapters';
import type { PlayerExplorerData } from './explorer';
import { shootingLine, type ShootingLine } from '../../nba/data/aggregate';
import type { PlayerSeason } from '../../nba/data/players';
import { rankSummaries, type RankSummary } from '../../nba/data/ranks';
import { retrieveLeagueContextRows, retrievePlayerGameRows, retrievePlayerSeasons, retrievePlayerShots, retrieveSeasonPlayerRows } from '../../resources/nbaShots';
import { PLAYER_CACHE, setCache, uncacheable } from './cache';
import { resolveSeason } from './home';

export interface NbaPlayerParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    player: PlayerSeason;
    line: ShootingLine;
    /** Tricodes of every team he shot for, primary first. */
    teams: string[];
    headshot: string | null;
    prev: PlayerSeason | null;
    next: PlayerSeason | null;
    explorer: PlayerExplorerData;
    ranks: RankSummary[];
    /** Seasons he took a regular-season shot in (the picker); just this one when that read failed. */
    hisSeasons: number[];
}

export type NbaPlayerPrep = { notFound: true } | { unavailable: true } | NbaPlayerParams;

export async function prepareNbaPlayer(Astro: AstroGlobal): Promise<NbaPlayerPrep> {
    Astro.locals.league = 'nba';
    const id = Astro.params.id ?? '';
    if (!/^\d{1,10}$/.test(id)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const personId = Number(id);
    const resolved = resolveSeason(Astro);
    const { season } = resolved;

    const reads = await Promise.allSettled([
        retrieveSeasonPlayerRows(season),
        retrieveLeagueContextRows(season),
        retrievePlayerShots(season, personId),
        retrievePlayerGameRows(season, personId),
        retrievePlayerSeasons(personId),
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
    const league = leagueContextFromRows(contextR.value);
    const line = shootingLine(shots);
    const roster = playerSeasonsFromRows(rows, player.team_id);
    const i = roster.findIndex((p) => p.person_id === personId);

    let degraded = false;
    let games = null;
    if (gamesR.status === 'fulfilled') {
        games = playerGamesFromRows(gamesR.value);
        if (games === null) console.warn(`[player ${personId}] per-game views unavailable: a game has no log row`);
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

    if (degraded) uncacheable(Astro);
    else setCache(Astro, PLAYER_CACHE);
    return {
        ...resolved,
        player,
        line,
        teams: teamsOfPlayer(rows, personId),
        headshot: headshotsFromRows(rows).get(personId) ?? null,
        prev: i > 0 ? roster[i - 1] : null,
        next: i >= 0 && i < roster.length - 1 ? roster[i + 1] : null,
        explorer: { shots, games, league, seasonFgPct: line.fgPct },
        ranks: rankSummaries(players, personId),
        hisSeasons,
    };
}
