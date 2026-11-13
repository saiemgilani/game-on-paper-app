// BB-G38, behind 'bball-shot-filters': what the game page's shot filters filter on. Each field goal gets its shooter,
// whether a make was assisted, its shot type and zone and its period clock; the menus list only what the game has and the
// state lives in the URL (`?shot_*=`). Pure: the server builds the shots and the first render, the island refilters.
import type { NbaPlay } from '../resources/nbaGame';
import type { Court } from './config';
import type { GameShot } from '../nba/charts/gameShotChart';
import { zoneOf, ZONES, type Zone } from '../nba/data/aggregate';
import type { PlaceholderLocation } from '../nba/data/placeholder';
import type { GameStints, Stint } from '../resources/gameStints';
import { fmtPct } from '../nba/format';

/** Shot types in menu order; a shot is the first that matches (an alley-oop dunk is a dunk, a putback layup a layup). */
export const SHOT_KINDS = { dunk: 'Dunks', layup: 'Layups', tip: 'Tip-ins', hook: 'Hook shots', jumper: 'Jump shots' } as const;
export type ShotKind = keyof typeof SHOT_KINDS | 'other';
// ESPN's type text across the four leagues: 'Driving Dunk Shot', 'Alley Oop Layup Shot', 'Cutting Finger Roll Layup Shot',
// 'Layup Driving Reverse', 'Tip Shot', 'Turnaround Hook Shot', 'Step Back Jump Shot', 'Three Point Jump Shot' (pros);
// 'DunkShot', 'LayUpShot', 'TipShot', 'JumpShot' (college; the text says 'Three Point Jumper')
const KIND_RE: [Exclude<ShotKind, 'other'>, RegExp][] = [
    ['dunk', /dunk/i], ['tip', /tip/i], ['layup', /lay ?up|finger ?roll|reverse/i], ['hook', /hook/i], ['jumper', /jump|fade|three point/i],
];
export function shotKind(typeText: string | null, text: string): ShotKind {
    for (const [k, re] of KIND_RE) if (re.test(typeText ?? '')) return k;
    for (const [k, re] of KIND_RE) if (re.test(text)) return k;
    return 'other';
}

/**
 * The pros' shot moves, a second menu (Saiem, #451 Q1): the NBA and WNBA type text carries them ('Driving Floating Jump Shot',
 * 'Pullup Jump Shot', 'Layup Shot Putback'); college's ('LayUpShot', 'JumpShot') has none. A shot can carry more than one.
 */
export const SHOT_MOVES = {
    driving: 'Driving', pullup: 'Pull-ups', floating: 'Floaters', turnaround: 'Turnarounds', stepback: 'Step-backs', alleyoop: 'Alley-oops', putback: 'Putbacks',
} as const;
export type ShotMove = keyof typeof SHOT_MOVES;
const MOVE_RE: Record<ShotMove, RegExp> = {
    driving: /driving/i, pullup: /pull ?up/i, floating: /floating/i, turnaround: /turnaround/i, stepback: /step ?back/i, alleyoop: /alley ?oop/i, putback: /putback/i,
};
export const shotMoves = (typeText: string | null): ShotMove[] => (Object.keys(MOVE_RE) as ShotMove[]).filter((m) => MOVE_RE[m].test(typeText ?? ''));

/** ESPN names the passer in the make's text: '(Josh Hart assists)' (NBA), 'Assisted by Ann Wauters.' (WNBA, college). */
export const isAssisted = (p: Pick<NbaPlay, 'scoringPlay' | 'text'>): boolean => p.scoringPlay && /\bassist/i.test(p.text);

/** 'M:SS' or 'SS.s' (ESPN's period clock) in seconds; null when it does not parse. */
export function clockSeconds(clock: string): number | null {
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(clock.trim());
    const v = m ? Number(m[1]) * 60 + Number(m[2]) : clock.trim() === '' ? NaN : Number(clock);
    return Number.isFinite(v) ? v : null;
}

/** A shot on the chart with what the filters read: `shooter` the ESPN athlete id ('' unknown), `secs` the period clock. */
export interface FilterShot extends GameShot { shooter: string; ast: boolean; kind: ShotKind; moves: ShotMove[]; zone: Zone | ''; secs: number | null }

/** One team's attempts (shotsOf) as filter shots. `base` is the page's own GameShot for the play (NbaGameShotCharts). */
export function filterShot(p: NbaPlay, base: GameShot, court: Court, at: PlaceholderLocation | null): FilterShot {
    // no zone for a shot ESPN did not locate, nor one at the league's placeholder location (D29), as the zone charts
    const placed = !base.unlocated && !(at && base.x === at.x && base.y === at.y);
    return {
        ...base, shooter: p.athleteId == null ? '' : String(p.athleteId), ast: isAssisted(p), kind: shotKind(p.typeText, p.text), moves: shotMoves(p.typeText),
        zone: placed ? zoneOf({ x_legacy: base.x, y_legacy: base.y, shot_value: base.value }, court) : '', secs: clockSeconds(p.clock),
    };
}

/** The filter state; '' is "all". `with` is an ESPN athlete id from the stints, `withMode` whether he was on or off. */
export interface ShotFilters {
    team: '' | 'away' | 'home'; player: string; period: string; result: '' | 'made' | 'missed'; zone: string; kind: string; move: string
    assist: '' | 'ast' | 'unast'; with: string; withMode: 'on' | 'off'
}
export const NO_FILTERS: ShotFilters = { team: '', player: '', period: '', result: '', zone: '', kind: '', move: '', assist: '', with: '', withMode: 'on' };

/** The URL's names: `shot_team`, `shot_player`, ..., and `shot_on=<id>` / `shot_off=<id>` for the ON/OFF filter. */
const PARAM: Record<Exclude<keyof ShotFilters, 'with' | 'withMode'>, string> = {
    team: 'shot_team', player: 'shot_player', period: 'shot_period', result: 'shot_result', zone: 'shot_zone', kind: 'shot_type', move: 'shot_move', assist: 'shot_assist',
};

/** The values each menu offers on this page; anything else in the URL is dropped. */
export interface FilterOptions { players: string[]; periods: string[]; zones: string[]; kinds: string[]; moves: string[]; withPlayers: string[] }

export function parseFilters(q: URLSearchParams, o: FilterOptions): ShotFilters {
    const pick = <T extends string>(v: string | null, allowed: readonly string[]): T | '' => (v != null && allowed.includes(v) ? (v as T) : '');
    const on = pick(q.get('shot_on'), o.withPlayers), off = pick(q.get('shot_off'), o.withPlayers);
    return {
        team: pick(q.get(PARAM.team), ['away', 'home']), player: pick(q.get(PARAM.player), o.players), period: pick(q.get(PARAM.period), o.periods),
        result: pick(q.get(PARAM.result), ['made', 'missed']), zone: pick(q.get(PARAM.zone), o.zones), kind: pick(q.get(PARAM.kind), o.kinds), move: pick(q.get(PARAM.move), o.moves),
        assist: pick(q.get(PARAM.assist), ['ast', 'unast']), with: on || off, withMode: on || !off ? 'on' : 'off',
    };
}

/** The URL with this state's `shot_*` params (the defaults left out) and every other param kept. */
export function withFilters(url: URL, f: ShotFilters): URL {
    const u = new URL(url);
    for (const p of [...Object.values(PARAM), 'shot_on', 'shot_off']) u.searchParams.delete(p);
    for (const [k, p] of Object.entries(PARAM) as [keyof typeof PARAM, string][]) if (f[k]) u.searchParams.set(p, f[k]);
    if (f.with) u.searchParams.set(f.withMode === 'on' ? 'shot_on' : 'shot_off', f.with);
    return u;
}

/**
 * Whether the player was on the floor at the period clock. A stint covers [clock_out, clock_in): a substitution at a shot's
 * second comes after the shot (on the four leagues' real stints this puts exactly five of the shooting team on the floor at
 * every field goal attempt, test/shotFilters.test.ts).
 */
export const onFloor = (stints: readonly Stint[], period: number, secs: number): boolean =>
    stints.some(([q, inAt, outAt]) => q === period && secs < inAt && secs >= outAt);

/** Team is the caller's (one chart per team); everything else is here. A shot with no clock fails an ON/OFF filter. */
export function matches(s: FilterShot, f: ShotFilters, stints: GameStints | null): boolean {
    if (f.player && s.shooter !== f.player) return false;
    if (f.period && String(s.period) !== f.period) return false;
    if (f.result && s.made !== (f.result === 'made')) return false;
    if (f.zone && s.zone !== f.zone) return false;
    if (f.kind && s.kind !== f.kind) return false;
    if (f.move && !s.moves.includes(f.move as ShotMove)) return false;
    if (f.assist && !(s.made && s.ast === (f.assist === 'ast'))) return false;
    if (f.with) {
        const st = stints?.[f.with];
        if (!st || s.secs == null) return false;
        if (onFloor(st, s.period, s.secs) !== (f.withMode === 'on')) return false;
    }
    return true;
}

export const isFiltered = (f: ShotFilters): boolean => Object.entries(f).some(([k, v]) => k !== 'withMode' && v !== '');

/** "FG 12-30 (40.0%), 2P 8-18 (44.4%), 3P 4-12 (33.3%), eFG 46.7%, 0.93 points per shot"; '' with no attempt. */
export function shotLine(shots: readonly Pick<GameShot, 'made' | 'value'>[]): string {
    if (shots.length === 0) return '';
    const three = shots.filter((s) => s.value === 3), two = shots.filter((s) => s.value !== 3);
    const m = (xs: readonly Pick<GameShot, 'made'>[]) => xs.filter((s) => s.made).length;
    const part = (label: string, xs: readonly Pick<GameShot, 'made'>[]) => `${label} ${m(xs)}-${xs.length}${xs.length ? ` (${fmtPct(m(xs) / xs.length)})` : ''}`;
    const pts = 2 * m(two) + 3 * m(three);
    return `${part('FG', shots)}, ${part('2P', two)}, ${part('3P', three)}, eFG ${fmtPct((m(shots) + 0.5 * m(three)) / shots.length)}, ${(pts / shots.length).toFixed(2)} points per shot`;
}

/** The zones a set of shots has, in ZONES order. */
export const zonesOf = (shots: readonly FilterShot[]): Zone[] => ZONES.filter((z) => shots.some((s) => s.zone === z));
/** The shot types a set of shots has, in menu order. */
export const kindsOf = (shots: readonly FilterShot[]): (keyof typeof SHOT_KINDS)[] =>
    (Object.keys(SHOT_KINDS) as (keyof typeof SHOT_KINDS)[]).filter((k) => shots.some((s) => s.kind === k));
/** The moves a set of shots has, in menu order (none in college). */
export const movesOf = (shots: readonly FilterShot[]): ShotMove[] => (Object.keys(SHOT_MOVES) as ShotMove[]).filter((m) => shots.some((s) => s.moves.includes(m)));
