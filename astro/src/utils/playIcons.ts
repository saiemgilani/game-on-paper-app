/**
 * Play marks: which pictograms a play-by-play row carries after its text.
 *
 * A play carries EVERY mark that applies, in the order things happen on the
 * field (sack -> turnover -> score -> flag -> explosive), so a strip-sack
 * returned for a score reads sack . fumble . touchdown. Routine punts and
 * kickoffs carry no mark by design (2026-09-01); only their failures do.
 *
 * Flags come straight from the processed play (sportsdataverse-py):
 * `downs_turnover` and `fumble_lost` are emitted by the pipeline, so nothing
 * here re-derives possession logic.
 */
export type PlayIconId =
    | 'sack' | 'int' | 'fumble' | 'blocked' | 'fg-miss' | 'downs'
    | 'fg' | 'safety' | 'td' | 'penalty' | 'explosive';

export const PLAY_ICON_ORDER: readonly PlayIconId[] = [
    'sack', 'int', 'fumble', 'blocked', 'fg-miss', 'downs', 'fg', 'safety', 'td', 'penalty', 'explosive',
];

export const PLAY_ICON_LABEL: Record<PlayIconId, string> = {
    sack: 'Sack',
    int: 'Interception',
    fumble: 'Fumble lost',
    blocked: 'Blocked kick',
    'fg-miss': 'Field goal missed',
    downs: 'Turnover on downs',
    fg: 'Field goal',
    safety: 'Safety',
    td: 'Touchdown',
    penalty: 'Penalty',
    explosive: 'Explosive play',
};

type FlagBag = { type?: { text?: string } } & Record<string, unknown>;

export function playIcons(play: FlagBag | null | undefined): PlayIconId[] {
    if (!play) return [];
    const on = (k: string) => play[k] === true;
    const out: PlayIconId[] = [];
    if (on('sack')) out.push('sack');
    if (on('int')) out.push('int');
    if (on('fumble_lost') || (on('fumble_vec') && on('change_of_pos_team'))) out.push('fumble');
    const blocked = on('turnover_vec') && /blocked/i.test(String(play.type?.text ?? ''));
    if (blocked) out.push('blocked');
    else if (on('fg_attempt') && !on('fg_made')) out.push('fg-miss');
    if (on('downs_turnover')) out.push('downs');
    if (on('fg_made')) out.push('fg');
    if (on('safety')) out.push('safety');
    if (on('touchdown')) out.push('td');
    if (on('penalty_flag')) out.push('penalty');
    if (on('EPA_explosive')) out.push('explosive');
    return out;
}
