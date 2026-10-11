import { readFileSync } from 'node:fs';
import type { GameLogRow, Shot } from '../../src/nba/data/shots';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());

/** The real 2,000-row Nets 2025-26 shot fixture (see fixtures/README.md). */
export async function fixtureShots(): Promise<Shot[]> {
    return read('shots');
}

/** Both teams' rows for the fixture's 24 games (48). */
export async function fixtureGameLogs(): Promise<GameLogRow[]> {
    return read('game_logs');
}

/**
 * A hand-placed shot for geometry cases. Distance is ROUNDED feet like the release
 * (round(hypot/10) matches 93-96% of release rows), so 1-ft bins are centred on their distance.
 */
export function shot(x: number, y: number, value: 2 | 3, made: boolean, game_id = '0022500001'): Shot {
    return {
        game_id, period: 1, clock: 'PT12M00.00S', team_id: 1610612751, team_tricode: 'BKN', person_id: 1, player_name: 'Test',
        sub_type: 'Jump Shot', shot_result: made ? 'Made' : 'Missed', shot_value: value,
        shot_distance: Math.round(Math.hypot(x, y) / 10), x_legacy: x, y_legacy: y,
    };
}
