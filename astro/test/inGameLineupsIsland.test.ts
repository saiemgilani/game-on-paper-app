// @vitest-environment jsdom
// BB-G37's island on the real BOS-DET read (fixtures/ingame-lineups-nba.json.gz): the size buttons, the small-sample toggle
// and the on/off picker, clicked. No network: the island takes its rows as props.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, test } from 'vitest';
import InGameLineups from '../src/components/nba/game/InGameLineups.svelte';
import { bigSample, inGameSide, pickSplit } from '../src/utils/inGameLineups';

const cap = JSON.parse(gunzipSync(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/ingame-lineups-nba.json.gz'))).toString());
const BOS = 1610612738;
const side = inGameSide({ units: cap.units, onOff: cap.onoff, season: cap.season }, BOS, (id) => `P${id}`);
const rowsOf = (t: HTMLElement, label: string) => t.querySelectorAll(`table[aria-label="${label}"] tbody tr`).length;
const button = (t: HTMLElement, group: string, text: string) => [...t.querySelectorAll(`[aria-label="${group}"] button`)].find((b) => b.textContent === text) as HTMLButtonElement;

describe('InGameLineups', () => {
    test('sizes, the sample toggle and the picker', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const c = mount(InGameLineups, { target, props: { side, abbr: 'BOS', id: 'ingame-away' } });
        expect(rowsOf(target, 'BOS 5-man units')).toBe(side.units[5].filter(bigSample).length);
        button(target, 'BOS unit size', '2-man').click(); flushSync();
        expect(rowsOf(target, 'BOS 2-man units')).toBe(side.units[2].filter(bigSample).length);
        (target.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); flushSync();
        expect(rowsOf(target, 'BOS 2-man units')).toBe(side.units[2].length);

        // whole game, then A ON (two combos with one player marked), then B OFF (four)
        const [a, b] = side.onOff.map((r) => String(r.player_id));
        expect(rowsOf(target, 'BOS on/off split')).toBe(1);
        button(target, `P${a}`, 'On').click(); flushSync();
        expect(rowsOf(target, 'BOS on/off split')).toBe(2);
        button(target, `P${b}`, 'Off').click(); flushSync();
        expect(rowsOf(target, 'BOS on/off split')).toBe(4);
        const active = target.querySelector('table[aria-label="BOS on/off split"] tr.table-active')!;
        const want = pickSplit(side.picker!, [a], [b]);
        expect(active.textContent).toContain(`${want.pts}–${want.opp_pts}`);
        expect(target.textContent).not.toContain('NaN');
        unmount(c);
        target.remove();
    });
});
