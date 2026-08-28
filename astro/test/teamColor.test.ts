import { describe, it, expect } from 'vitest';
import { teamColorHex, STANDARD_THEME_COLOR } from '../src/utils/misc';

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
