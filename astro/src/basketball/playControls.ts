// BB-G40, behind 'bball-pbp-controls': what the game page's play-by-play controls filter on. Each play gets its event kinds,
// its score change and whether it is a big win-probability swing; the menus list only what the game has. Pure: the
// component renders these as data attributes and its script only shows, hides and reorders rows.
import type { NbaGame, NbaPlay } from '../resources/nbaGame';
import { isSettle } from '../nba/data/game';

/** Event kinds in menu order. A play can be several (a made jumper is scoring and a field goal; an offensive foul turnover is both). */
export const PLAY_KINDS = {
    scoring: 'Scoring plays', fg: 'Field goals', ft: 'Free throws', reb: 'Rebounds',
    tov: 'Turnovers & steals', foul: 'Fouls', sub: 'Substitutions', timeout: 'Timeouts',
} as const;
export type PlayKind = keyof typeof PLAY_KINDS;

// ESPN's type text across the four leagues: 'Free Throw - 1 of 2' / 'Free Throw 1 of 2' (pros), 'MadeFreeThrow' (college);
// 'Bad Pass\nTurnover', 'Steal' (college logs steals as their own row), 'Traveling'; 'ShootingFoul', 'Offensive Charge',
// 'Defensive 3-Seconds Technical'; 'OfficialTVTimeOut', 'Full Timeout'. Field goals are ESPN's shooting plays less free throws.
const FT = /free ?throw/i;
const KIND_TEST: Record<PlayKind, (p: NbaPlay, type: string) => boolean> = {
    scoring: (p) => p.scoringPlay,
    fg: (p, t) => p.shootingPlay && !FT.test(t),
    ft: (p, t) => p.shootingPlay && FT.test(t),
    reb: (_, t) => /rebound/i.test(t),
    tov: (_, t) => /turnover|steal|traveling/i.test(t),
    foul: (_, t) => /foul|charge|technical/i.test(t),
    sub: (_, t) => /substitution/i.test(t),
    timeout: (_, t) => /time ?out/i.test(t),
};

export function playKinds(p: NbaPlay): PlayKind[] {
    const t = p.typeText ?? '';
    return (Object.keys(KIND_TEST) as PlayKind[]).filter((k) => KIND_TEST[k](p, t));
}

/** A swing of at least five WP points (|wp_delta| >= 0.05): roughly the top 5-8% of plays in a game, in all four leagues. */
export const BIG_SWING = 0.05;

/** A play that moved the game: not the opening row (measured from the pregame prior) nor a period-end settle. */
export const isBigSwing = (p: NbaPlay) => p.wpDelta != null && !isSettle(p) && Math.abs(p.wpDelta) >= BIG_SWING;

/** The WPA cell's value: home WP's change on the play; null on a settle row, whose change is the clock running out, not a play. */
export const playWpa = (p: NbaPlay) => (isSettle(p) ? null : p.wpDelta);

export interface ControlledPlay { play: NbaPlay; kinds: PlayKind[]; big: boolean; wpa: number | null; homePts: number; awayPts: number }

export interface PlayControls {
    /** game order (oldest first) */
    plays: ControlledPlay[]
    kinds: { kind: PlayKind; label: string; n: number }[]
    /** athletes in the play-by-play, by side, most plays first; named from the box, else skipped */
    players: { side: 'away' | 'home'; options: { id: number; name: string; n: number }[] }[]
    big: number
}

export function playControls(game: NbaGame): PlayControls {
    const plays: ControlledPlay[] = [];
    let prev = { home: 0, away: 0 };
    for (const p of game.plays) {
        // the change from the play before, not score_value: ESPN's corrections and and-ones land on the score columns
        plays.push({ play: p, kinds: playKinds(p), big: isBigSwing(p), wpa: playWpa(p), homePts: p.homeScore - prev.home, awayPts: p.awayScore - prev.away });
        prev = { home: p.homeScore, away: p.awayScore };
    }
    const kinds = (Object.keys(PLAY_KINDS) as PlayKind[]).map((kind) => ({ kind, label: PLAY_KINDS[kind], n: plays.filter((c) => c.kinds.includes(kind)).length })).filter((k) => k.n > 0);
    const count = new Map<number, number>();
    for (const p of game.plays) if (p.athleteId != null) count.set(p.athleteId, (count.get(p.athleteId) ?? 0) + 1);
    const players = (['away', 'home'] as const).map((side) => ({
        side,
        options: game[side].players.filter((r) => count.has(r.athlete_id)).map((r) => ({ id: r.athlete_id, name: r.name, n: count.get(r.athlete_id)! }))
            .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    })).filter((g) => g.options.length > 0);
    return { plays, kinds, players, big: plays.filter((c) => c.big).length };
}

/** The `?order=` the sort toggle keeps in the URL: 'newest' or 'oldest'; anything else is the default (newest first while live). */
export const ORDER_PARAM = 'order';
export const newestFirstFor = (live: boolean, order: string | null): boolean => (order === 'newest' ? true : order === 'oldest' ? false : live);

/** Live as the game header says it (listed positively): a suspended, delayed or postponed game with plays is not live. */
export const isLiveGame = (status: NbaGame['status']): boolean => !status.completed && ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD'].includes(status.name);
