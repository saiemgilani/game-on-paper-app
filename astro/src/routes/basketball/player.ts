/**
 * Page-side step of /<league>/players/[id]: blazing-the-nets' loadPlayerPage + assemblePlayerPage
 * over the Data API. Mirrors routes/player.ts: the prep is testable, the page file stays
 * short, a malformed id is a 404 before any read, the identity-bearing reads (season players,
 * league context, his shots) must succeed or the page is a 503, and the decorative reads
 * (games, his seasons) degrade and turn caching off.
 */
import type { AstroGlobal } from 'astro';
import { courtFor, placeholderFor, rankMins } from '../../basketball/config';
import { isNcaaDashboards } from '../../basketball/dashboards';
import { headshotsFromRows, leagueContextFromRows, playerGamesFromRows, playerSeasonsFromRows, shotsFromRows, teamsOfPlayer } from '../../nba/adapters';
import type { PlayerExplorerData } from '../nba/explorer';
import { shootingLine, type ShootingLine } from '../../nba/data/aggregate';
import { COURT } from '../../nba/data/court';
import { placeholderSplit } from '../../nba/data/placeholder';
import type { PlayerSeason } from '../../nba/data/players';
import { rankSummaries, type RankMins, type RankSummary } from '../../nba/data/ranks';
import { retrieveLeagueContextRows, retrievePlayerGameRows, retrievePlayerSeasons, retrievePlayerShots, retrieveSeasonPlayerRows } from '../../resources/nbaShots';
import { retrievePlayerImpact, type PlayerImpactRow } from '../../resources/playerImpact';
import { hasEpv, retrievePlayerEpv, retrievePlayerWar, type EpvPlayerGameRow, type PlayerWarRow } from '../../resources/playerWar';
import { retrievePlayerShotQuality, type ShotQualityRow } from '../../resources/shotQuality';
import { isFeatureEnabled } from '../../utils/features';
import type { BasketballLeague } from '../../utils/league';
import { playerCache, setCache, uncacheable } from './cache';
import { readCoverageNote, resolveBasketballSeason } from './season';

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
    /** a college season's shot_coverage sentence (D24); absent for the NBA/WNBA */
    coverage?: string | null;
    /** BB-G15, only with 'bball-poe' on: his shot quality season rows (one per team); null when the read failed */
    poe?: ShotQualityRow[] | null;
    /** BB-G6, only with 'bball-impact' on: his impact rows (player_impact, college player_value); null when the read failed */
    impact?: PlayerImpactRow[] | null;
    /** BB-G27, only with 'bball-war' on: his player_war rows; null when the read failed */
    war?: PlayerWarRow[] | null;
    /** BB-G27, only with 'bball-war' on and an NBA season from 2021-22: his EPV game rows; null when the read failed */
    epv?: EpvPlayerGameRow[] | null;
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

    const coverageP = readCoverageNote(league, season);
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

    // BB-G6: the same rule as BB-G15's below, started first so the two reads run together
    const impactP = isFeatureEnabled('bball-impact', Astro.locals) ? readPlayerImpact(league, season, personId) : undefined;
    // BB-G27: the same rule again, its reads started with BB-G6's
    const withWar = isFeatureEnabled('bball-war', Astro.locals);
    const warP = withWar ? readDecorative('WAR', league, season, personId, retrievePlayerWar) : undefined;
    const epvP = withWar && hasEpv(league, season) ? readDecorative('EPV', league, season, personId, retrievePlayerEpv) : undefined;
    // BB-G15: read only once the page will render; decorative, so a failed read keeps the page and turns caching off
    const poe = isFeatureEnabled('bball-poe', Astro.locals) ? { poe: await readPlayerPoe(league, season, personId) } : {};
    if (poe.poe === null) degraded = true;
    const impact = impactP ? { impact: await impactP } : {};
    if (impact.impact === null) degraded = true;
    const war = warP ? { war: await warP } : {};
    const epv = epvP ? { epv: await epvP } : {};
    if (war.war === null || epv.epv === null) degraded = true;

    // seasonFgPct (line) still counts every shot: D29 "counted"
    const n = placeholderSplit(shots, placeholder).unlocated;
    const min = rankMins(league, season);
    if (degraded) uncacheable(Astro);
    else setCache(Astro, playerCache(league));
    const coverage = await coverageP;
    if (coverage === undefined) uncacheable(Astro);
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
        ...(isNcaaDashboards(league) ? { coverage: coverage ?? null } : {}),
        ...poe,
        ...impact,
        ...war,
        ...epv,
    };
}

/** BB-G6's read (the same person id as readPlayerPoe's); null when it failed. */
async function readPlayerImpact(league: BasketballLeague, season: number, personId: number): Promise<PlayerImpactRow[] | null> {
    try {
        return await retrievePlayerImpact(league, season, personId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} impact for player ${personId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G27's reads (the season tables' person id, as readPlayerPoe's); null when the read failed. */
async function readDecorative<T>(what: string, league: BasketballLeague, season: number, personId: number,
    read: (league: BasketballLeague, season: number, personId: number) => Promise<T[]>): Promise<T[] | null> {
    try {
        return await read(league, season, personId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} ${what} for player ${personId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G15's read (the season tables' person id: stats.nba.com's for the NBA/WNBA, ESPN's in college); null when it failed. */
async function readPlayerPoe(league: BasketballLeague, season: number, personId: number): Promise<ShotQualityRow[] | null> {
    try {
        return await retrievePlayerShotQuality(league, season, personId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} shot quality for player ${personId}: ${e}, ${e?.stack}`);
        return null;
    }
}
