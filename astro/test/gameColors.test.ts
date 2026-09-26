import { describe, expect, it } from 'vitest';
import { generateRadarDataset } from '../src/utils/radar';
import {
    pickGameColors, deltaE2000, contrastRatio, adjustTeamColorsForContrast, hexToRgb,
    GAME_BACKGROUNDS, GAME_COLOR_MIN_DELTA_E, GAME_COLOR_MIN_CONTRAST,
} from '../src/utils/misc';

// The report that started this: gameonpaper.com/game/401858242, Boston College
// (home) vs Virginia Tech, two maroons. ESPN's header colours are what the game
// page reads (teamInfo); team_info is what the matchup view reads.
const BC_ESPN = { color: '8c2232', alternateColor: 'dbcca6' };
const VT_ESPN = { color: '6a2c3e', alternateColor: 'cf4520' };
const BC_TEAM_INFO = { color: '#8c2232', alt_color: '#dbcca6' };
const VT_TEAM_INFO = { color: '#861f41', alt_color: '#e87722' };

const hex = (c: { r: number, g: number, b: number }) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
type Theme = keyof typeof GAME_BACKGROUNDS;
const THEMES: Theme[] = ['light', 'dark'];

// usable on a theme: apart, and each colour reads on that theme's background
function expectUsable(pair: { home: string, away: string }, theme: Theme) {
    expect(pair.home).toMatch(/^#[0-9a-f]{6}$/);
    expect(pair.away).toMatch(/^#[0-9a-f]{6}$/);
    expect(deltaE2000(pair.home, pair.away)).toBeGreaterThanOrEqual(GAME_COLOR_MIN_DELTA_E);
    for (const c of [pair.home, pair.away]) {
        expect(contrastRatio(c, GAME_BACKGROUNDS[theme]), `${c} on ${theme}`).toBeGreaterThanOrEqual(GAME_COLOR_MIN_CONTRAST);
    }
}
const expectUsableBoth = (colors: ReturnType<typeof pickGameColors>) => THEMES.forEach((t) => expectUsable(colors[t], t));

describe('colour maths', () => {
    it('ΔE2000: zero on identity, symmetric, ~100 from black to white', () => {
        expect(deltaE2000('#8c2232', '#8c2232')).toBe(0);
        expect(deltaE2000('#8c2232', '#6a2c3e')).toBeCloseTo(deltaE2000('#6a2c3e', '#8c2232'), 10);
        expect(deltaE2000('#000000', '#ffffff')).toBeCloseTo(100, 0);
    });
    it('WCAG contrast: black on white is 21:1, a colour on itself 1:1', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('#8c2232', '#8c2232')).toBe(1);
    });
});

describe('pickGameColors', () => {
    it('BC vs VT: the two maroons are not what the page paints, on either theme', () => {
        // the legacy rule leaves them together: ΔE2000 between the primaries
        expect(deltaE2000('#8c2232', '#6a2c3e')).toBeLessThan(GAME_COLOR_MIN_DELTA_E);
        const [away, home] = adjustTeamColorsForContrast(VT_ESPN, BC_ESPN).map(hex);
        expect(deltaE2000(home, away)).toBeLessThan(GAME_COLOR_MIN_DELTA_E);

        // Light: BC keeps its maroon and VT takes its orange alt, both true colours.
        // Dark: BC's maroon is too dark for #181a1b, so BC takes its gold alt
        // (the last candidate, both alts). Nothing is recoloured on either theme.
        const colors = pickGameColors(BC_ESPN, VT_ESPN);
        expectUsableBoth(colors);
        expect(colors).toEqual({
            light: { home: '#8c2232', away: '#cf4520' },
            dark: { home: '#dbcca6', away: '#cf4520' },
        });
    });

    it('BC vs VT from team_info reaches the same shape of answer', () => {
        const colors = pickGameColors(BC_TEAM_INFO, VT_TEAM_INFO);
        expectUsableBoth(colors);
        expect(colors).toEqual({
            light: { home: '#8c2232', away: '#e87722' },
            dark: { home: '#dbcca6', away: '#e87722' },
        });
    });

    it('is deterministic', () => {
        expect(pickGameColors(BC_ESPN, VT_ESPN)).toEqual(pickGameColors(BC_ESPN, VT_ESPN));
    });

    it('keeps both primaries when they already work', () => {
        // Georgia Tech gold vs a mid blue: far apart, readable on both backgrounds
        const pair = { home: '#b3a369', away: '#2394fd' };
        expect(pickGameColors({ color: 'b3a369' }, { color: '2394fd' })).toEqual({ light: pair, dark: pair });
    });

    it('keeps the primaries on the theme they work on, even when the other theme cannot', () => {
        // navy vs Georgia red: fine on white; navy is unreadable on #181a1b
        const colors = pickGameColors({ color: '041e42', alternateColor: 'a2aaad' }, { color: 'ba0c2f', alternateColor: '000000' });
        expect(colors.light).toEqual({ home: '#041e42', away: '#ba0c2f' });
        expect(colors.dark.home).not.toBe('#041e42');
        expectUsableBoth(colors);
    });

    it('tries the away alt before the home alt', () => {
        // identical primaries; both alts readable and distinct from the primary
        const pair = { home: '#c8102e', away: '#2394fd' };
        expect(pickGameColors({ color: 'c8102e', alternateColor: 'e87722' }, { color: 'c8102e', alternateColor: '2394fd' })).toEqual({ light: pair, dark: pair });
    });

    it("treats team_info's 'null' strings as missing and falls back to ESPN", () => {
        for (const missing of ['null', '#null', '', null, undefined]) {
            const colors = pickGameColors(
                [{ color: missing, alt_color: missing }, BC_ESPN],
                [{ color: missing, alt_color: missing }, VT_ESPN],
            );
            expect(colors).toEqual(pickGameColors(BC_ESPN, VT_ESPN));
        }
    });

    it('never throws and never clashes when a team has no colour at all', () => {
        expectUsableBoth(pickGameColors({ color: 'null', alt_color: 'null' }, undefined));
        expectUsableBoth(pickGameColors(null, null));
    });

    // The lowest-ΔE2000 primary pairs in ESPN's own headers, three per era,
    // 2004-2026 (scratchpad scan of cfbfastR-cfb-raw; one per colour pair).
    const WORST = [
        { game: '242830349', season: 2004, homeName: 'Army Black Knights', home: { color: '000000', alternateColor: 'd3bc8d' }, awayName: 'Cincinnati Bearcats', away: { color: '000000', alternateColor: 'e00122' } },
        { game: '243622649', season: 2004, homeName: 'Connecticut Huskies', home: { color: '0c2340', alternateColor: 'a2aaad' }, awayName: 'Toledo Rockets', away: { color: '0b2240', alternateColor: 'ffcd00' } },
        { game: '262732026', season: 2006, homeName: 'Appalachian State Mountaineers', home: { color: '000000', alternateColor: 'ffcd00' }, awayName: 'Elon Phoenix', away: { color: '020303', alternateColor: 'b59a57' } },
        { game: '302602440', season: 2010, homeName: 'Nevada Wolf Pack', home: { color: '041e42', alternateColor: '8a8d8f' }, awayName: 'California Golden Bears', away: { color: '041e42', alternateColor: 'ffc72c' } },
        { game: '320082459', season: 2011, homeName: 'Northern Illinois Huskies', home: { color: 'c8102e', alternateColor: '000000' }, awayName: 'Arkansas State Red Wolves', away: { color: 'cc092f', alternateColor: '000000' } },
        { game: '333202426', season: 2013, homeName: 'Navy Midshipmen', home: { color: '00225b', alternateColor: 'b5a67c' }, awayName: 'South Alabama Jaguars', away: { color: '00205b', alternateColor: 'bf0d3e' } },
        { game: '400941829', season: 2017, homeName: 'Tulane Green Wave', home: { color: '006747', alternateColor: '418fde' }, awayName: 'South Florida Bulls', away: { color: '006747', alternateColor: 'cfc493' } },
        { game: '401012281', season: 2018, homeName: 'Tennessee Volunteers', home: { color: 'ff8200', alternateColor: 'ffffff' }, awayName: 'UTEP Miners', away: { color: 'ff8200', alternateColor: '041e42' } },
        { game: '400852683', season: 2015, homeName: 'Georgia State Panthers', home: { color: '0039a6', alternateColor: 'ffffff' }, awayName: 'San Jose State Spartans', away: { color: '0038a8', alternateColor: 'ffb81a' } },
        { game: '401442015', season: 2022, homeName: 'Georgia Bulldogs', home: { color: 'ba0c2f', alternateColor: '2c2a29' }, awayName: 'Ohio State Buckeyes', away: { color: 'ba0c2f', alternateColor: 'a8adb4' } },
        { game: '401858224', season: 2026, homeName: 'Purdue Boilermakers', home: { color: 'ceb888', alternateColor: '000000' }, awayName: 'Wake Forest Demon Deacons', away: { color: 'ceb888', alternateColor: '2c2a29' } },
        { game: '401643744', season: 2024, homeName: 'San Diego State Aztecs', home: { color: 'a6192e', alternateColor: '000000' }, awayName: 'Washington State Cougars', away: { color: 'a60f2d', alternateColor: '4d4d4d' } },
    ];
    it.each(WORST)('$game ($season) $homeName vs $awayName: separated and readable on each theme', ({ home, away }) => {
        expect(deltaE2000(`#${home.color}`, `#${away.color}`)).toBeLessThan(1);
        expectUsableBoth(pickGameColors(home, away));
    });
});

describe('the radar takes the decided pair for its theme', () => {
    // breakdowns are [away, home], as MatchupView builds them
    const teams = [{ teamName: 'Virginia Tech', ...VT_ESPN }, { teamName: 'Boston College', ...BC_ESPN }];
    const rgb = (c: { r: number, g: number, b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;
    it.each(THEMES)('paints the %s pair', (theme) => {
        const colors = pickGameColors(BC_ESPN, VT_ESPN);
        const data = generateRadarDataset(teams, 'Offensive', 'Defensive', theme === 'dark', 'cfb', colors);
        expect(data.datasets.map((d) => d.borderColor)).toEqual([colors[theme].away, colors[theme].home].map((c) => rgb(hexToRgb(c)!)));
    });
    it('keeps the legacy rule without one', () => {
        const data = generateRadarDataset(teams, 'Offensive', 'Defensive', false, 'cfb');
        expect(data.datasets.map((d) => d.borderColor)).toEqual(adjustTeamColorsForContrast(VT_ESPN, BC_ESPN).map(rgb));
    });
});
