// Row shading for play tables (CFB and NFL): red = possession lost, green = score,
// yellow = penalty.
//
// Red used to include "any 4th-down play that gained less than the distance and
// isn't a punt or timeout". A penalty snap on 4th down -- delay of game or illegal
// formation in punt formation, "No Play" -- matched that and read as a turnover
// (DEN @ KC 401872931, Q3 10:03). The processor already decides turnover on downs
// as `downs_turnover`, so red trusts it; the yardage rule survives only for payloads
// that predate that field, and never for a penalty or no-play.
import { TURNOVER_VEC } from './constants';

export type ShadeablePlay = {
    type?: { text?: string | null } | null;
    text?: string | null;
    start?: { down?: number | null; distance?: number | null } | null;
    statYardage?: number | null;
    change_of_pos_team?: boolean | null;
    downs_turnover?: boolean | null;
    turnover_vec?: boolean | null;
    penalty_flag?: boolean | null;
    scoringPlay?: boolean | null;
    scoring_play?: boolean | null;
};

export type PlayShade = '' | 'table-danger' | 'table-success' | 'table-warning';

function isPenaltySnap(play: ShadeablePlay): boolean {
    const type = String(play.type?.text ?? '');
    const text = String(play.text ?? '');
    return play.penalty_flag === true || /penalty/i.test(type) || /\bno play\b/i.test(text);
}

export function isTurnoverOnDowns(play: ShadeablePlay): boolean {
    if (typeof play.downs_turnover === 'boolean') return play.downs_turnover;
    // legacy payloads without the flag: the old yardage rule, minus penalty snaps
    const type = String(play.type?.text ?? '');
    return play.start?.down === 4
        && typeof play.statYardage === 'number' && typeof play.start?.distance === 'number'
        && play.statYardage < play.start.distance
        && !/punt|timeout|field goal|kneel|end of/i.test(type)
        && !isPenaltySnap(play);
}

export function isPossessionLost(play: ShadeablePlay): boolean {
    const type = String(play.type?.text ?? '');
    const text = String(play.text ?? '');
    return TURNOVER_VEC.includes(type)
        || play.turnover_vec === true
        || (/fumble/i.test(text) && play.change_of_pos_team === true)
        || isTurnoverOnDowns(play);
}

export function playShade(play: ShadeablePlay): PlayShade {
    if (isPossessionLost(play)) return 'table-danger';
    if (play.scoringPlay === true || play.scoring_play === true) return 'table-success';
    if (String(play.text ?? '').toLocaleLowerCase().includes('penalty')) return 'table-warning';
    return '';
}
