import { describe, it, expect } from 'vitest';
import { teamColorHex, STANDARD_THEME_COLOR, cx } from '../src/utils/misc';

// ESPN omits `color` for some schools (LIU 2341, West Florida 110242). Those
// used to 500 the team page and kill DriveChart hydration on `.startsWith`.
describe('teamColorHex', () => {
  it('prefixes a bare hex', () => expect(teamColorHex('9e1b32')).toBe('#9e1b32'));
  it('passes through an already-prefixed hex', () => expect(teamColorHex('#9e1b32')).toBe('#9e1b32'));
  it('falls back when ESPN omits the color', () => {
    for (const missing of [undefined, null, '', '   ']) {
      expect(teamColorHex(missing as any)).toBe(STANDARD_THEME_COLOR);
    }
  });
  it('honors an explicit fallback', () => expect(teamColorHex(undefined, '#000000')).toBe('#000000'));
  it('never returns a string containing undefined', () => {
    expect(teamColorHex(undefined)).not.toContain('undefined');
  });
});

// Guards the class-attribute leak: every game card on the scoreboard and home
// page rendered class="... undefined spice-level-none", because the default
// theme branch returns no outlineClass and it was interpolated directly.
describe('cx', () => {
  it('drops undefined instead of printing it', () => {
    expect(cx('row border', undefined, 'spice-level-none')).toBe('row border spice-level-none');
  });
  it('drops null, empty and false', () => {
    expect(cx('a', null, '', false, 'b')).toBe('a b');
  });
  it('never emits the literal "undefined"', () => {
    expect(cx('base', undefined, undefined)).not.toContain('undefined');
  });
  it('is a no-op on an all-present list', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });
});
