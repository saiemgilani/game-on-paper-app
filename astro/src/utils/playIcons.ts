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
    | 'sack' | 'tfl' | 'stuffed'
    | 'int' | 'fumble' | 'blocked' | 'fg-miss' | 'downs' | 'goal-line' | 'three-out'
    | 'fg' | 'safety' | 'td' | 'td-xp' | 'td-xp-miss' | 'td-2pt' | 'td-2pt-miss'
    | 'penalty' | 'penalty-declined' | 'penalty-offset' | 'explosive';

export const PLAY_ICON_ORDER: readonly PlayIconId[] = [
    'sack', 'tfl', 'stuffed', 'int', 'fumble', 'blocked', 'fg-miss', 'downs', 'goal-line', 'three-out',
    'fg', 'safety', 'td', 'td-xp', 'td-xp-miss', 'td-2pt', 'td-2pt-miss',
    'penalty', 'penalty-declined', 'penalty-offset', 'explosive',
];

export const PLAY_ICON_LABEL: Record<PlayIconId, string> = {
    sack: 'Sack', tfl: 'Tackle for loss', stuffed: 'Stuffed run',
    int: 'Interception', fumble: 'Fumble lost', blocked: 'Blocked kick', 'fg-miss': 'Field goal missed',
    downs: 'Turnover on downs', 'goal-line': 'Goal-line stand', 'three-out': 'Three and out',
    fg: 'Field goal', safety: 'Safety',
    td: 'Touchdown', 'td-xp': 'Touchdown, PAT good', 'td-xp-miss': 'Touchdown, PAT missed',
    'td-2pt': 'Touchdown, 2-point conversion good', 'td-2pt-miss': 'Touchdown, 2-point conversion failed',
    penalty: 'Penalty', 'penalty-declined': 'Penalty declined', 'penalty-offset': 'Offsetting penalties',
    explosive: 'Explosive play',
};

/** Two marks are set as text pills rather than pictograms (decided 2026-09-01 after nine drawing rounds). */
export const PLAY_PILL_TEXT: Partial<Record<PlayIconId, string>> = { sack: 'SACK', tfl: 'TFL' };

/** Marks shown in the table legend, in a reading order that groups families. */
export const PLAY_ICON_LEGEND: readonly PlayIconId[] = [
    'td', 'td-xp', 'td-2pt', 'fg', 'safety', 'int', 'fumble', 'downs', 'blocked', 'fg-miss',
    'sack', 'tfl', 'stuffed', 'three-out', 'goal-line', 'penalty', 'penalty-declined', 'penalty-offset', 'explosive',
];

type FlagBag = { type?: { text?: string }; start?: { yardsToEndzone?: number | null } } & Record<string, unknown>;

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

    // behind the line
    if (on('sack')) out.push('sack');
    else if (on('TFL') || on('TFL_rush') || on('TFL_pass')) out.push('tfl');
    else if (on('stuffed_run')) out.push('stuffed');

    // possession
    if (on('int')) out.push('int');
    if (on('fumble_lost') || (on('fumble_vec') && on('change_of_pos_team'))) out.push('fumble');
    const blocked = on('is_blocked_punt_turnover') || on('is_blocked_fg_turnover') || on('punt_blocked')
        || (on('turnover_vec') && /blocked/i.test(typeText));
    if (blocked) out.push('blocked');
    else if (on('fg_attempt') && !on('fg_made')) out.push('fg-miss');
    if (on('downs_turnover')) {
        const ytez = Number(play.start?.yardsToEndzone ?? NaN);
        out.push(ytez <= 5 ? 'goal-line' : 'downs');
    }
    if (ctx.threeAndOut || on('three_and_out')) out.push('three-out');

    // points
    if (on('fg_made')) out.push('fg');
    if (on('safety')) out.push('safety');
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
    if (on('EPA_explosive')) out.push('explosive');
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
