/**
 * 'decision-summary' counts only the fourth-down snap that stands (fourthDownDecision), on real processed plays:
 * fixtures/fourth-down-penalties-nfl-2025.json (the Python API's own play rows, see fixtures/README.md) and the punt
 * of fixtures/game-401772944-nfl.json.gz.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { fourthDownActual, fourthDownDecision, fourthDownSummary } from '../src/utils/fourthDown';

const rows = JSON.parse(readFileSync(new URL('./fixtures/fourth-down-penalties-nfl-2025.json', import.meta.url), 'utf8'));
const play = (game: string, id: string) => rows[game].plays.find((p: any) => String(p.id) === id);
const nfl944 = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-401772944-nfl.json.gz', import.meta.url))).toString());

// BAL at BUF 2025 wk 1: 4th & 2, Allen's incompletion, defensive holding on Baltimore -- a first down.
const PENALTY_GO = play('401772918', '4017729182338');
// PHI at MIN 2025 wk 7: Wentz's 4th-down touchdown wiped out by an offensive foul (replayed), Philadelphia's
// delay of game before a field goal try, and Hurts's kneel at 0:02.
const WIPED_OUT = play('401772862', '4017728621400');
const DELAY = play('401772862', '4017728624041');
const KNEEL = play('401772862', '4017728624065');
// LV at DEN 2025 wk 10: a Las Vegas punt with a Denver foul on the return.
const PUNT_FOUL = nfl944.plays.find((p: any) => String(p.id) === '4017729443338');

describe('fourthDownDecision', () => {
    test('a run or pass the defense fouled into a first down is a go', () => {
        expect([PENALTY_GO.type.text, PENALTY_GO.first_down_penalty, PENALTY_GO.fourth_down_recommendation]).toEqual(['Penalty', true, 'go']);
        expect(fourthDownDecision(PENALTY_GO)).toBe('go');
        const [buf] = fourthDownSummary([PENALTY_GO], ['2']);
        expect([buf.decisions, buf.agreed]).toEqual([1, 1]);
    });

    test('a penalty on a punt is skipped, though the card still reads the punt', () => {
        expect([PUNT_FOUL.punt, PUNT_FOUL.penalty_flag]).toEqual([true, true]);
        expect(fourthDownActual(PUNT_FOUL)).toBe('punt');
        expect(fourthDownDecision(PUNT_FOUL)).toBeNull();
        expect(fourthDownSummary([PUNT_FOUL], ['13'])[0].decisions).toBe(0);
    });

    test('a pre-snap foul or a snap wiped out and replayed is skipped', () => {
        expect(DELAY.penalty_detail).toBe('Delay of Game');
        expect([WIPED_OUT.pass, WIPED_OUT.penalty_no_play, WIPED_OUT.first_down_penalty]).toEqual([true, true, false]);
        expect(fourthDownActual(WIPED_OUT)).toBe('go');
        expect(fourthDownDecision(WIPED_OUT)).toBeNull();
        expect(fourthDownDecision(DELAY)).toBeNull();
        const [min, phi] = fourthDownSummary([WIPED_OUT, DELAY], ['16', '21']);
        expect([min.decisions, phi.decisions]).toEqual([0, 0]);
    });

    test('a kneel is no decision', () => {
        expect([KNEEL.kneel_down, KNEEL.rush, KNEEL.fourth_down_recommendation]).toEqual([true, true, 'field_goal']);
        expect(fourthDownActual(KNEEL)).toBe('go');
        expect(fourthDownDecision(KNEEL)).toBeNull();
        const [phi] = fourthDownSummary([KNEEL], ['21']);
        expect([phi.decisions, phi.wpLost]).toEqual([0, 0]);
    });
});
