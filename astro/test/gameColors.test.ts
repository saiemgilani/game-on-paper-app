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
const readable = (c: string) => contrastRatio(c, GAME_BACKGROUNDS.light) >= GAME_COLOR_MIN_CONTRAST
    && contrastRatio(c, GAME_BACKGROUNDS.dark) >= GAME_COLOR_MIN_CONTRAST;

function expectUsable(pair: { home: string, away: string }) {
    expect(pair.home).toMatch(/^#[0-9a-f]{6}$/);
    expect(pair.away).toMatch(/^#[0-9a-f]{6}$/);
    expect(deltaE2000(pair.home, pair.away)).toBeGreaterThanOrEqual(GAME_COLOR_MIN_DELTA_E);
    expect(readable(pair.home), `${pair.home} on both backgrounds`).toBe(true);
    expect(readable(pair.away), `${pair.away} on both backgrounds`).toBe(true);
}

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
    it('BC vs VT: the two maroons are not what the page paints', () => {
        // the legacy rule leaves them together: ΔE2000 between the primaries
        expect(deltaE2000('#8c2232', '#6a2c3e')).toBeLessThan(GAME_COLOR_MIN_DELTA_E);
        const [away, home] = adjustTeamColorsForContrast(VT_ESPN, BC_ESPN).map(hex);
        expect(deltaE2000(home, away)).toBeLessThan(GAME_COLOR_MIN_DELTA_E);

        // No raw pair works: both maroons (and BC's maroon against anything) are
        // too dark for the dark theme, and BC's gold too light for the light one.
        // Lifted to read on both, BC maroon vs VT orange is 18 apart, so the next
        // candidate in order (home alt + away primary) wins: BC gold, VT maroon,
        // each moved just far enough in L* to read on both backgrounds.
        const pair = pickGameColors(BC_ESPN, VT_ESPN);
        expectUsable(pair);
        expect(pair).toEqual({ home: '#aea17c', away: '#874657' });
    });

    it("BC vs VT from team_info: VT's lighter orange clears, so BC keeps its maroon", () => {
        const pair = pickGameColors(BC_TEAM_INFO, VT_TEAM_INFO);
        expectUsable(pair);
        expect(pair).toEqual({ home: '#a03542', away: '#e87722' });
    });

    it('is deterministic', () => {
        expect(pickGameColors(BC_ESPN, VT_ESPN)).toEqual(pickGameColors(BC_ESPN, VT_ESPN));
    });

    it('keeps both primaries when they already work', () => {
        // Georgia Tech gold vs a mid blue: far apart, both readable
        expect(pickGameColors({ color: 'b3a369' }, { color: '2394fd' })).toEqual({ home: '#b3a369', away: '#2394fd' });
    });

    it('tries the away alt before the home alt', () => {
        // identical primaries; both alts readable and distinct from the primary
        const pair = pickGameColors({ color: 'c8102e', alternateColor: 'e87722' }, { color: 'c8102e', alternateColor: '2394fd' });
        expect(pair).toEqual({ home: '#c8102e', away: '#2394fd' });
    });

    it("treats team_info's 'null' strings as missing and falls back to ESPN", () => {
        for (const missing of ['null', '#null', '', null, undefined]) {
            const pair = pickGameColors(
                [{ color: missing, alt_color: missing }, BC_ESPN],
                [{ color: missing, alt_color: missing }, VT_ESPN],
            );
            expect(pair).toEqual(pickGameColors(BC_ESPN, VT_ESPN));
        }
    });

    it('never throws and never clashes when a team has no colour at all', () => {
        expectUsable(pickGameColors({ color: 'null', alt_color: 'null' }, undefined));
        expectUsable(pickGameColors(null, null));
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
    it.each(WORST)('$game ($season) $homeName vs $awayName: separated and readable in both themes', ({ home, away }) => {
        expect(deltaE2000(`#${home.color}`, `#${away.color}`)).toBeLessThan(1);
        expectUsable(pickGameColors(home, away));
    });
});

describe('the radar takes the decided pair', () => {
    // breakdowns are [away, home], as MatchupView builds them
    const teams = [{ teamName: 'Virginia Tech', ...VT_ESPN }, { teamName: 'Boston College', ...BC_ESPN }];
    const rgb = (c: { r: number, g: number, b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;
    it('paints the pair when given one', () => {
        const pair = pickGameColors(BC_ESPN, VT_ESPN);
        const data = generateRadarDataset(teams, 'Offensive', 'Defensive', false, 'cfb', pair);
        expect(data.datasets.map((d) => d.borderColor)).toEqual([pair.away, pair.home].map((c) => rgb(hexToRgb(c)!)));
    });
    it('keeps the legacy rule without one', () => {
        const data = generateRadarDataset(teams, 'Offensive', 'Defensive', false, 'cfb');
        expect(data.datasets.map((d) => d.borderColor)).toEqual(adjustTeamColorsForContrast(VT_ESPN, BC_ESPN).map(rgb));
    });
});
