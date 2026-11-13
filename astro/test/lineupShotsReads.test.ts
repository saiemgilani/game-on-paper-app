// BB-G52's two reads: the query each sends (season filter, side key, the pros' regular-season prefix, select, limit) and the
// timeout that keeps a slow upstream from holding the team page. retrieveRowsFrom is mocked: nothing reaches the Data API.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const sdv = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRowsFrom: sdv.rows }));
import { READ_TIMEOUT_MS, retrieveLineupCrosswalk, retrieveLineupShotRows } from '../src/resources/lineupShots';

beforeEach(() => { sdv.rows.mockReset(); sdv.rows.mockResolvedValue([]); });

describe('lineup shot reads', () => {
    test('NBA offense: team_id, the 002 prefix, the offensive five, strict and timed', async () => {
        await retrieveLineupShotRows(2026, 1610612751, 'offense', 'nba');
        const [source, table, query, , strict, timeout] = sdv.rows.mock.calls[0];
        expect(source.schema).toBe('nba_stats');
        expect(table).toBe('shot_lineups');
        expect(query).toEqual({
            season: '2026', team_id: '1610612751', game_id__like: '002%',
            select: 'game_id,x_legacy,y_legacy,shot_value,made,off_player_1,off_player_2,off_player_3,off_player_4,off_player_5', limit: '50000',
        });
        expect(strict).toBe(true);
        expect(timeout).toBe(READ_TIMEOUT_MS);
    });
    test('college defense: opp_team_id and both fives (defending, then shooting), every game; the crosswalk keys the ESPN team', async () => {
        await retrieveLineupShotRows(2027, 36, 'defense', 'wbb');
        expect(sdv.rows.mock.calls[0][2]).toEqual({
            season: '2027', opp_team_id: '36', limit: '50000',
            select: 'game_id,x_legacy,y_legacy,shot_value,made,def_player_1,def_player_2,def_player_3,def_player_4,def_player_5,off_player_1,off_player_2,off_player_3,off_player_4,off_player_5',
        });
        sdv.rows.mockResolvedValueOnce([{ ncaa_player_id: '11510623', espn_athlete_id: 5242454 }]);
        expect(await retrieveLineupCrosswalk(2027, 36, 'wbb')).toEqual([['11510623', '5242454']]);
        expect(sdv.rows.mock.calls[1][1]).toBe('ncaa_player_crosswalk');
        expect(sdv.rows.mock.calls[1][2]).toEqual({ season: '2027', espn_team_id: '36', select: 'ncaa_player_id,espn_athlete_id', limit: '50000' });
        // no team: the league's crosswalk (the defense view names the opponents too), still season-filtered
        await retrieveLineupCrosswalk(2027, null, 'wbb');
        expect(sdv.rows.mock.calls[2][2]).toEqual({ season: '2027', select: 'ncaa_player_id,espn_athlete_id', limit: '50000' });
    });
    test('the pros need no crosswalk read; a read at the cap fails loud', async () => {
        expect(await retrieveLineupCrosswalk(2026, 1610612751, 'nba')).toEqual([]);
        expect(sdv.rows).not.toHaveBeenCalled();
        sdv.rows.mockResolvedValueOnce(new Array(50000).fill({}));
        await expect(retrieveLineupShotRows(2026, 1, 'offense', 'nba')).rejects.toThrow(/cap/);
    });
});
