import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { edgeLabel, isRateEdge, storyView, STORY_EDGES, type GameStory } from '../src/utils/gameStory';

// Real games, written by python/game_story.py from sportsdataverse-py's game story (python/tests/fixtures/game_story):
// a college overtime game, an NFL tie (GB 40, DAL 40) and an NBA game.
const load = (name: string): GameStory => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const cfb = load('game-story-cfb-401628333.json');
const tie = load('game-story-nfl-401772921.json');
const nba = load('game-story-nba-401810169.json');

describe('storyView', () => {
    it('lists the three largest edges in rank order, the winner first', () => {
        const v = storyView(cfb, true)!;
        expect(v.decided).toBe(true);
        expect(v.edges).toHaveLength(STORY_EDGES);
        expect(v.edges.map((e) => e.rank)).toEqual([1, 2, 3]);
        expect(v.edges[0].points_worth).toBeGreaterThan(0);
        expect(v.winnerId).toBe(cfb.summary.winner_team_id);
        expect(v.runs[0].team_id).toBe(v.winnerId);
        expect(v.performers[0].team_id).toBe(v.winnerId);
        expect(v.unitLabel).toBe('EPA');
        expect(v.moment?.rule).toBe('max_abs_wpa');
    });

    it('reads a tie from the home side, with no winner', () => {
        const v = storyView(tie, true)!;
        expect(v.decided).toBe(false);
        expect(v.winnerId).toBeNull();
        expect(v.margin).toBe(0);
        expect(v.performers[0].team_id).toBe(tie.summary.home_team_id);
    });

    it('keeps basketball in points, and the four-factor parts add up to the margin', () => {
        const v = storyView(nba, false)!;
        expect(v.unitLabel).toBe('Pts');
        const acct = nba.edges.filter((e) => e.kind === 'accounting').reduce((s, e) => s + (e.points_worth ?? 0), 0);
        expect(acct).toBeCloseTo(nba.summary.margin, 9);
    });

    it('shows nothing without a story or a priced edge', () => {
        expect(storyView(null, true)).toBeNull();
        expect(storyView(undefined, false)).toBeNull();
        expect(storyView({ ...nba, edges: nba.edges.map((e) => ({ ...e, points_worth: null })) }, false)).toBeNull();
    });
});

describe('labels', () => {
    it('names every edge the game story emits', () => {
        for (const e of [...cfb.edges, ...nba.edges]) expect(edgeLabel(e.edge)).not.toContain('_');
        expect(edgeLabel('success_rate')).toBe('Success Rate');
        expect(isRateEdge('success_rate')).toBe(true);
        expect(isRateEdge('passing')).toBe(false);
    });
});
