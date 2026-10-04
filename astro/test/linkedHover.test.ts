import { describe, expect, test } from 'vitest';
import { driveIdFromHref, driveRange, playNumberFromHref, wpIndex } from '../src/utils/linkedHover';
import { loadGzJson } from './helpers/tables';

const game = loadGzJson('usage-cfb-400869270.json.gz');
// the WP chart's x axis: scrimmage plays in game order, mapped the way GamePage maps them
const points = game.plays
    .filter((p: any) => p.scrimmage_play == true)
    .map((p: any) => ({ game_play_number: p.game_play_number, drive_id: p['drive.id'] }));

describe('linked hover keys', () => {
    test('a play row href names its play, whatever the table prefix', () => {
        expect(playNumberFromHref('#play-all-123')).toBe(123);
        expect(playNumberFromHref('#play-most-important-play-7')).toBe(7);
        expect(playNumberFromHref('#drive-drives-4008692701')).toBeNull();
        expect(playNumberFromHref('')).toBeNull();
        expect(playNumberFromHref(null)).toBeNull();
    });

    test('a drive row href names its drive', () => {
        expect(driveIdFromHref('#drive-drives-4008692701')).toBe('4008692701');
        expect(driveIdFromHref('#play-all-12')).toBeNull();
    });

    test('every scrimmage play finds its own WP point; a kick finds none', () => {
        points.forEach((p: any, i: number) => expect(wpIndex(points, p.game_play_number)).toBe(i));
        const kick = game.plays.find((p: any) => p.scrimmage_play != true);
        expect(wpIndex(points, kick.game_play_number)).toBe(-1);
        expect(wpIndex(points, null)).toBe(-1);
    });

    test('a drive covers exactly the WP points of its plays', () => {
        const id = String(points[0].drive_id);
        const mine = points.flatMap((p: any, i: number) => (String(p.drive_id) === id ? [i] : []));
        expect(driveRange(points, id)).toEqual({ from: Math.min(...mine), to: Math.max(...mine) });
        expect(driveRange(points, 'no-such-drive')).toBeNull();
        expect(driveRange(points, null)).toBeNull();
    });
});
