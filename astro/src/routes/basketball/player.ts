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
import { retrievePlayerSituational } from '../../resources/situational';
import { retrieveLeagueContextRows, retrievePlayerGameRows, retrievePlayerSeasons, retrievePlayerShots, retrieveSeasonPlayerRows, type SeasonPlayerRow } from '../../resources/nbaShots';
import { retrievePlayerImpactCareer, retrievePlayerWarCareer } from '../../resources/playerCareer';
import { retrievePlayerImpact, type PlayerImpactRow } from '../../resources/playerImpact';
import { retrievePlayerOnOff } from '../../resources/playerOnOff';
import { PLAYER_PLAY_STYLE_LEAGUES, retrievePlayerPlayStyle } from '../../resources/playStyles';
import { hasMatchups, hasPlayTypes, retrievePlayerHustle, retrievePlayerMatchupRollup, retrievePlayerSynergy, retrievePlayerTopMatchups, type HustleRow, type MatchupRollupRow, type MatchupRow, type SynergyRow } from '../../resources/playerPlayTypes';
import { hasEpv, retrievePlayerEpv, retrievePlayerWar, type EpvPlayerSeasonRow, type PlayerWarRow } from '../../resources/playerWar';
import { retrievePlayerShotQuality, type ShotQualityRow } from '../../resources/shotQuality';
import { isFeatureEnabled } from '../../utils/features';
import { impactShown } from '../../utils/playerImpact';
import type { BasketballLeague } from '../../utils/league';
import { parseSituation, situationsFor, type PlayerSituationsTab } from '../../utils/situations';
import { espnPartners, topPartners, type PlayerOnOff } from '../../utils/playerOnOff';
import { playerPlayStyles, type PlayStyleChip } from '../../utils/playStyles';
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
    /** BB-G25, only with 'bball-situational' on: the Situations section's control and his split rows; `rows` null when the read failed */
    situations?: PlayerSituationsTab;
    /** BB-G15, only with 'bball-poe' on: his shot quality season rows (one per team); null when the read failed */
    poe?: ShotQualityRow[] | null;
    /** BB-G6, only with 'bball-impact' on: his impact rows (player_impact, college player_value); null when the read failed */
    impact?: PlayerImpactRow[] | null;
    /** BB-G7, only with 'bball-player-on-off' on: his on/off rows and top partners; `teams` null when a read failed */
    onOff?: PlayerOnOff;
    /** BB-G17, only with 'bball-play-styles' on, NBA and college: his play-style chips; null when the read failed */
    playStyles?: PlayStyleChip[] | null;
    /** BB-G27, only with 'bball-war' on: his player_war rows; null when the read failed */
    war?: PlayerWarRow[] | null;
    /** BB-G27, only with 'bball-war' on and a season from 2021-22: his epv_player_seasons row; null when the read failed */
    epv?: EpvPlayerSeasonRow[] | null;
    /** BB-G19, only with 'bball-play-types' on and an NBA season from 2015-16: his Synergy, hustle and (from 2017-18) matchup rows */
    playTypes?: PlayerPlayTypes;
    /** BB-G54, only with 'bball-career' on: every season of his player_war rows and (NBA/WNBA) player_impact rows; a failed read is null */
    career?: { war: PlayerWarRow[] | null; impact?: PlayerImpactRow[] | null };
}

/** BB-G19's rows, each null when its read failed. */
export interface PlayerPlayTypes {
    synergy: SynergyRow[] | null;
    hustle: HustleRow[] | null;
    /** absent before 2017-18, the matchup tables' first season */
    rollup?: MatchupRollupRow[] | null;
    matchups?: MatchupRow[] | null;
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
    // college reads through ncaa_player_crosswalk (BB-D37); utils/playerImpact.ts COLLEGE_IMPACT is its kill switch
    const impactP = isFeatureEnabled('bball-impact', Astro.locals) && impactShown(isNcaaDashboards(league)) ? readPlayerImpact(league, season, personId) : undefined;
    // BB-G7: the same rule, all four leagues; college maps its stats.ncaa.org ids through ncaa_player_crosswalk (BB-D37)
    const onOffP = isFeatureEnabled('bball-player-on-off', Astro.locals) ? readPlayerOnOff(league, season, personId, player.team_id, rows) : undefined;
    // BB-G17: the same rule; the WNBA has no play-style table
    const stylesP = isFeatureEnabled('bball-play-styles', Astro.locals) && PLAYER_PLAY_STYLE_LEAGUES.includes(league) ? readPlayerPlayStyles(league, season, personId) : undefined;
    // BB-G27: the same rule again, its reads started with BB-G6's
    const withWar = isFeatureEnabled('bball-war', Astro.locals);
    const warP = withWar ? readDecorative('WAR', league, season, personId, retrievePlayerWar) : undefined;
    const epvP = withWar && hasEpv(league, season) ? readDecorative('EPV', league, season, personId, retrievePlayerEpv) : undefined;
    // BB-G19: the same rule again, NBA only, its reads started with BB-G6's
    const playTypesP = isFeatureEnabled('bball-play-types', Astro.locals) && hasPlayTypes(league, season) ? readPlayTypes(league, season, personId) : undefined;
    // BB-G54: every season of the league's range, one cached read per player whichever season page asked; college has no
    // impact columns (BB-D16, as BB-G6)
    const withCareer = isFeatureEnabled('bball-career', Astro.locals);
    const [first, last] = [resolved.seasons[0] ?? season, resolved.seasons[resolved.seasons.length - 1] ?? season];
    const careerWarP = withCareer ? readDecorative('career WAR', league, season, personId, (lg, _s, id) => retrievePlayerWarCareer(lg, first, last, id)) : undefined;
    const careerImpactP = withCareer && (league === 'nba' || league === 'wnba')
        ? readDecorative('career impact', league, season, personId, (_lg, _s, id) => retrievePlayerImpactCareer(league, first, last, id)) : undefined;
    // BB-G15: read only once the page will render; decorative, so a failed read keeps the page and turns caching off
    const poe = isFeatureEnabled('bball-poe', Astro.locals) ? { poe: await readPlayerPoe(league, season, personId) } : {};
    if (poe.poe === null) degraded = true;
    const impact = impactP ? { impact: await impactP } : {};
    if (impact.impact === null) degraded = true;
    const onOff = onOffP ? { onOff: await onOffP } : {};
    if (onOff.onOff?.teams === null) degraded = true;
    const playStyles = stylesP ? { playStyles: await stylesP } : {};
    if (playStyles.playStyles === null) degraded = true;
    const war = warP ? { war: await warP } : {};
    const epv = epvP ? { epv: await epvP } : {};
    if (war.war === null || epv.epv === null) degraded = true;
    const playTypes = playTypesP ? { playTypes: await playTypesP } : {};
    if (playTypes.playTypes && Object.values(playTypes.playTypes).includes(null)) degraded = true;
    const career = careerWarP ? { career: { war: await careerWarP, ...(careerImpactP ? { impact: await careerImpactP } : {}) } } : {};
    if (career.career && (career.career.war === null || career.career.impact === null)) degraded = true;

    // seasonFgPct (line) still counts every shot: D29 "counted"
    const n = placeholderSplit(shots, placeholder).unlocated;
    const min = rankMins(league, season);
    if (degraded) uncacheable(Astro);
    else setCache(Astro, playerCache(league));
    // read only once the page will render (a 404 or 503 never spends it), alongside the coverage note
    const situationsOn = isFeatureEnabled('bball-situational', Astro.locals);
    const [coverage, situations] = await Promise.all([coverageP, situationsOn ? readPlayerSituations(Astro, league, season, personId, player.team_id) : undefined]);
    if (coverage === undefined || situations?.rows === null) uncacheable(Astro);
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
        ...(situationsOn ? { situations } : {}),
        ...poe,
        ...impact,
        ...onOff,
        ...playStyles,
        ...war,
        ...epv,
        ...playTypes,
        ...career,
    };
}

/** The player page's Situations section (BB-G25): ?situation= and his split rows with his team; `rows` null when a read failed (decorative). */
async function readPlayerSituations(Astro: AstroGlobal, league: BasketballLeague, season: number, personId: number, teamId: number): Promise<PlayerSituationsTab> {
    const options = situationsFor(league, season);
    const situation = parseSituation(Astro.url.searchParams.get('situation'), options);
    try {
        return { situation, options, rows: await retrievePlayerSituational(league, season, personId, teamId) };
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} situational splits for player ${personId}: ${e}, ${e?.stack}`);
        return { situation, options, rows: null };
    }
}

/** BB-G17's read (the page's person id: stats.nba.com's for the NBA, ESPN's in college) as chips; null when it failed. */
async function readPlayerPlayStyles(league: BasketballLeague, season: number, personId: number): Promise<PlayStyleChip[] | null> {
    try {
        return playerPlayStyles(await retrievePlayerPlayStyle(league, season, personId), league !== 'nba');
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} play styles for player ${personId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G6's read (the same person id as readPlayerPoe's); null when it failed. */
export async function readPlayerImpact(league: BasketballLeague, season: number, personId: number): Promise<PlayerImpactRow[] | null> {
    try {
        return await retrievePlayerImpact(league, season, personId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} impact for player ${personId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G7's reads, his top partners and the names and tricodes from the page's season rows; `teams` null when a read failed. */
async function readPlayerOnOff(league: BasketballLeague, season: number, personId: number, teamId: number, rows: SeasonPlayerRow[]): Promise<PlayerOnOff> {
    const names = new Map(rows.map((r) => [String(r.person_id), r.player_name]));
    const tricodes = new Map(rows.map((r) => [String(r.team_id), r.team_tricode]));
    try {
        const { teams, pairs, playerId, toEspn } = await retrievePlayerOnOff(league, season, personId, teamId);
        const partners = playerId === null ? [] : topPartners(pairs, playerId);
        // college: each teammate's stats.ncaa.org id as the page's ESPN id (names, links)
        return { teams, partners: toEspn ? espnPartners(partners, toEspn) : partners, names, tricodes, ...(playerId === null ? { unmatched: true as const } : {}) };
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} on/off for player ${personId}: ${e}, ${e?.stack}`);
        return { teams: null, partners: [], names, tricodes };
    }
}

/** BB-G27's reads (the season tables' person id, as readPlayerPoe's); null when the read failed. */
export async function readDecorative<T>(what: string, league: BasketballLeague, season: number, personId: number,
    read: (league: BasketballLeague, season: number, personId: number) => Promise<T[]>): Promise<T[] | null> {
    try {
        return await read(league, season, personId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} ${what} for player ${personId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G19's reads, together; each its own null on failure, so one outage keeps the other lines. */
async function readPlayTypes(league: BasketballLeague, season: number, personId: number): Promise<PlayerPlayTypes> {
    const one = <T>(what: string, read: (season: number, personId: number) => Promise<T[]>) =>
        readDecorative(what, league, season, personId, (_l, s, p) => read(s, p));
    if (!hasMatchups(league, season)) {
        const [synergy, hustle] = await Promise.all([one('play types', retrievePlayerSynergy), one('hustle', retrievePlayerHustle)]);
        return { synergy, hustle };
    }
    const [synergy, hustle, rollup, matchups] = await Promise.all([
        one('play types', retrievePlayerSynergy), one('hustle', retrievePlayerHustle),
        one('matchup rollup', retrievePlayerMatchupRollup), one('matchups', retrievePlayerTopMatchups),
    ]);
    return { synergy, hustle, rollup, matchups };
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
