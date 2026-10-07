import { describe, expect, test } from 'vitest';
import { wpExportFooter, wpExportTitle } from '../src/utils/chartExport';
import { cleanLocation } from '../src/utils/misc';
import { loadGzJson } from './helpers/tables';

const g = loadGzJson('usage-cfb-400869270.json.gz');   // CMU 30 at OKST 27, final
const [home, away] = g.header.competitions[0].competitors; // ESPN lists home first
const url = 'https://gameonpaper.com/game/400869270';

describe('WP chart export text', () => {
    test('the title is the header line, then the chart and its state', () => {
        expect(wpExportTitle(away, home, 'Final'))
            .toBe(`${cleanLocation(away.team)} 30 @ ${cleanLocation(home.team)} 27: Win Probability (Final)`);
    });

    test('a final game carries its URL; a live one also carries its data time', () => {
        const iso = '2026-09-26T18:00:00Z';
        expect(wpExportFooter({ title: '', url, completed: true, updatedAt: iso }, () => 'never')).toBe(url);
        expect(wpExportFooter({ title: '', url, completed: false, updatedAt: iso }, (t) => t.slice(11, 16)))
            .toBe(`${url} | Updated 18:00`);
        expect(wpExportFooter({ title: '', url, completed: false, updatedAt: null }, () => 'never')).toBe(url);
    });
});
