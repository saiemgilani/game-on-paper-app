/**
 * Play marks: which pictograms a play-by-play row carries after its text.
 *
 * A play carries EVERY mark that applies, in the order things happen on the
 * field (sack/tackle -> turnover -> score -> flag -> explosive), so a
 * strip-sack returned for a score reads sack . fumble . touchdown. Routine
 * punts and kickoffs carry no mark (decided 2026-09-01); only their failures do.
 * The conversion result rides on the touchdown mark itself (td-xp, td-2pt, ...).
 *
 * Flags come straight from the processed play (sportsdataverse-py); the two
 * drive-shaped marks (3-and-out, goal-line stand) are the only derived ones.
 */
export type PlayIconId =
    | 'onside' | 'sack' | 'tfl' | 'stuffed'
    | 'int' | 'fumble' | 'fumble-kept' | 'blocked' | 'fg-miss' | 'downs' | 'goal-line' | 'three-out'
    | 'third-conv' | 'fourth-conv' | 'fg' | 'safety' | 'def-2pt' | 'td' | 'td-xp' | 'td-xp-miss' | 'td-2pt' | 'td-2pt-miss'
    | 'penalty' | 'penalty-declined' | 'penalty-offset' | 'explosive';

export const PLAY_ICON_ORDER: readonly PlayIconId[] = [
    'onside', 'sack', 'tfl', 'stuffed', 'int', 'fumble', 'fumble-kept', 'blocked', 'fg-miss', 'downs', 'goal-line', 'three-out',
    'third-conv', 'fourth-conv', 'fg', 'safety', 'def-2pt', 'td', 'td-xp', 'td-xp-miss', 'td-2pt', 'td-2pt-miss',
    'penalty', 'penalty-declined', 'penalty-offset', 'explosive',
];

export const PLAY_ICON_LABEL: Record<PlayIconId, string> = {
    onside: 'Onside kick', sack: 'Sack', tfl: 'Tackle for loss', stuffed: 'Stuffed run',
    int: 'Interception', fumble: 'Fumble lost', 'fumble-kept': 'Fumble, recovered', blocked: 'Blocked kick', 'fg-miss': 'Field goal missed',
    downs: 'Turnover on downs', 'goal-line': 'Goal-line stand', 'three-out': 'Three and out',
    'third-conv': '3rd down converted', 'fourth-conv': '4th down converted', fg: 'Field goal', safety: 'Safety', 'def-2pt': 'Defensive 2-point conversion',
    td: 'Touchdown', 'td-xp': 'Touchdown, PAT good', 'td-xp-miss': 'Touchdown, PAT missed',
    'td-2pt': 'Touchdown, 2-point conversion good', 'td-2pt-miss': 'Touchdown, 2-point conversion failed',
    penalty: 'Penalty', 'penalty-declined': 'Penalty declined', 'penalty-offset': 'Offsetting penalties',
    explosive: 'Explosive play',
};

/** Two marks are set as text pills rather than pictograms (decided 2026-09-01 after nine drawing rounds). */
/**
 * Explosive-return cutoffs: the 80th percentile of return-team EPA over the 15
 * seasons 2011-2025 of ESPN CFB play-by-play, counting only plays that were
 * actually returned -- no touchback, fair catch, onside kick, out-of-bounds,
 * downed or blocked kick. Kickoffs n=74,593 (p80 +0.68); punts n=43,888
 * (p80 +0.58). Replaces the old fixed yardage rule (40 kickoff / 30 punt yards),
 * which missed return touchdowns entirely -- those carry no return-yards value.
 */
export const RETURN_EXPLOSIVE_EPA = { kickoff: 0.68, punt: 0.58 } as const;

export const PLAY_PILL_TEXT: Partial<Record<PlayIconId, string>> = { sack: 'SACK', tfl: 'TFL', onside: 'ONSIDE' };

/** Marks shown in the table legend, in a reading order that groups families. */
export const PLAY_ICON_LEGEND: readonly PlayIconId[] = [
    'td', 'td-xp', 'td-2pt', 'fg', 'safety', 'def-2pt', 'int', 'fumble', 'fumble-kept', 'downs', 'blocked', 'fg-miss',
    'sack', 'tfl', 'stuffed', 'three-out', 'goal-line', 'third-conv', 'fourth-conv', 'onside', 'penalty', 'penalty-declined', 'penalty-offset', 'explosive',
];

type FlagBag = { type?: { text?: string }; start?: { yardsToEndzone?: number | null; down?: number | null } } & Record<string, unknown>;

/**
 * Optional drive context the caller can pass (GamePage has all plays; the
 * util keeps no state): `threeAndOut` = this is the punt that ended a drive of
 * three scrimmage plays with no first down.
 */
export interface PlayIconContext { threeAndOut?: boolean }

export function playIcons(play: FlagBag | null | undefined, ctx: PlayIconContext = {}): PlayIconId[] {
    if (!play) return [];
    const on = (k: string) => play[k] === true;
    const typeText = String(play.type?.text ?? '');
    const out: PlayIconId[] = [];

    // special-teams gambits
    if (on('kickoff_onside')) out.push('onside');

    // behind the line
    if (on('sack')) out.push('sack');
    else if (on('TFL') || on('TFL_rush') || on('TFL_pass')) out.push('tfl');
    else if (on('stuffed_run')) out.push('stuffed');

    // possession
    if (on('int')) out.push('int');
    // fumble_lost / fumble_vec cover scrimmage fumbles; muffed kicks carry only
    // fumble_or_muff (and the kicking-team-recovery types in turnover_vec)
    const muffedAway = (on('fumble_or_muff') && on('change_of_pos_team')) || (on('turnover_vec') && /fumble/i.test(typeText));
    if (on('fumble_lost') || (on('fumble_vec') && on('change_of_pos_team')) || muffedAway) out.push('fumble');
    else if ((on('fumble_vec') || on('fumble_or_muff')) && !on('change_of_pos_team')) out.push('fumble-kept');
    const blocked = on('is_blocked_punt_turnover') || on('is_blocked_fg_turnover') || on('punt_blocked')
        || (on('turnover_vec') && /blocked/i.test(typeText));
    if (blocked) out.push('blocked');
    else if (on('fg_attempt') && !on('fg_made')) out.push('fg-miss');
    if (on('downs_turnover')) {
        const ytez = Number(play.start?.yardsToEndzone ?? NaN);
        out.push(ytez <= 5 ? 'goal-line' : 'downs');
    }
    if (ctx.threeAndOut || on('three_and_out')) out.push('three-out');
    // late-down conversions, on a snap (not a kick). NOTE: firstD_by_* are lagged
    // onto the NEXT play; the converting play carries first_down_earned/created.
    const converted = (on('first_down_earned') || on('first_down_created')) && !on('punt') && !on('fg_attempt') && !on('kickoff_play');
    const down = Number(play.start && (play.start as any).down);
    if (converted && down === 3) out.push('third-conv');
    if (converted && down === 4) out.push('fourth-conv');

    // points
    if (on('fg_made')) out.push('fg');
    if (on('safety')) out.push('safety');
    if (typeText === 'Defensive 2pt Conversion') out.push('def-2pt');
    if (on('touchdown')) {
        const two = String(play.two_point_conv_result ?? '').toLowerCase();
        const xp = String(play.extra_point_result ?? '').toLowerCase();
        if (two === 'good') out.push('td-2pt');
        else if (two && two !== 'none') out.push('td-2pt-miss');
        else if (on('xp_made') || xp === 'good') out.push('td-xp');
        else if (on('xp_attempt') || (xp && xp !== 'none')) out.push('td-xp-miss');
        else out.push('td');
    }

    // flags
    if (on('penalty_flag')) {
        if (on('penalty_offset')) out.push('penalty-offset');
        else if (on('penalty_declined') || on('penalty_all_declined')) out.push('penalty-declined');
        else out.push('penalty');
    }
    // EPA_explosive covers scrimmage plays; returns are judged on return-team EPA
    // against RETURN_EXPLOSIVE_EPA (see that constant for the derivation).
    // EPA is pos_team-relative, and pos_team is the RETURN team on a kickoff but
    // the PUNTING team on a punt, so the punt side reads the negated value.
    const epa = Number(play.EPA);
    const returned = (kind: 'kickoff' | 'punt') => on(`${kind}_play`)
        && !on(`${kind}_tb`) && !on(`${kind}_fair_catch`) && !on(`${kind}_oob`)
        && !on(`${kind}_downed`) && !on(`${kind}_safety`);
    const bigReturn = Number.isFinite(epa) && (
        (returned('kickoff') && !on('kickoff_onside') && epa >= RETURN_EXPLOSIVE_EPA.kickoff)
        || (returned('punt') && !on('punt_blocked') && -epa >= RETURN_EXPLOSIVE_EPA.punt));
    if (on('EPA_explosive') || bigReturn) out.push('explosive');
    return out;
}

/**
 * Annotate a game's plays with drive context for playIcons(). A three-and-out is
 * a punt ending a drive whose scrimmage plays before it numbered three or fewer
 * with no first down gained. Keyed by `drive.id`; plays without one are skipped.
 */
export function threeAndOutPlays(plays: FlagBag[]): Set<unknown> {
    const byDrive = new Map<unknown, FlagBag[]>();
    for (const p of plays) { const id = p['drive.id']; if (id == null) continue; if (!byDrive.has(id)) byDrive.set(id, []); byDrive.get(id)!.push(p); }
    const out = new Set<unknown>();
    for (const drive of byDrive.values()) {
        const scrimmage = drive.filter((p) => p.scrimmage_play === true && p.punt !== true);
        const punt = drive.find((p) => p.punt === true);
        const firstDown = drive.some((p) => p.firstD_by_yards === true || p.firstD_by_penalty === true || p.first_by_penalty === true || p.firstD_by_poss === true);
        if (punt && scrimmage.length <= 3 && scrimmage.length > 0 && !firstDown) out.add(punt.game_play_number);
    }
    return out;
}
