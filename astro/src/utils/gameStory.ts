/**
 * 'game-story' (preview): the "How they won it" panel on the football and basketball game pages. The numbers are
 * sportsdataverse-py's game story (cfb_game_story / nfl_game_story / nba_game_story), computed by the processor
 * (python/game_story.py) and passed through as `gameStory`; nothing is recomputed here. This module only picks what
 * the panel shows and labels it. Pure, so the page and the tests share it.
 */

export interface StorySummary {
    game_id: number; home_team_id: number; away_team_id: number; home_score: number; away_score: number
    winner_team_id: number | null; loser_team_id: number | null; margin: number; decided: boolean
    periods_agree: boolean; n_periods: number | null; overtime: boolean
}
export interface StoryEdge {
    edge: string; kind: 'accounting' | 'split'; unit: string
    winner_value: number | null; loser_value: number | null; points_worth: number | null; rank: number
}
export interface StoryMoment {
    play_id: number | null; order: number; period: number; clock: string | null; team_id: number | null; text: string | null
    wpa: number; winner_wpa: number | null; home_score: number; away_score: number; rule: 'max_abs_wpa' | 'deciding_score'
}
export interface StoryPeriod { period: number; period_label: string; is_overtime: boolean; home_pts: number; away_pts: number; home_cum: number; away_cum: number }
export interface StoryRun { team_id: number; points: number; start_period: number; end_period: number; home_score_after: number; away_score_after: number }
export interface StoryPerformer { team_id: number; player_id: number | null; player_name: string | null; metric: string; value: number }
export interface GameStory {
    summary: StorySummary; edges: StoryEdge[]; moment: StoryMoment | null
    periods: StoryPeriod[]; runs: StoryRun[]; performers: StoryPerformer[]
}

/** How many edges the panel lists. */
export const STORY_EDGES = 3;

/** Edge name -> its label, in the site's metric names where one exists (utils/misc SDV_BASE_METRIC_TITLES). */
const LABELS: Record<string, string> = {
    shooting: 'Shooting', turnovers: 'Turnovers', rebounding: 'Rebounding', free_throws: 'Free throws',
    three_pt_points: '3-point points', points_off_turnovers: 'Points off turnovers', fast_break_points: 'Fast-break points',
    points_in_paint: 'Points in the paint',
    passing: 'Passing', rushing: 'Rushing', special_teams: 'Special teams', other: 'Other plays',
    explosive_plays: 'Explosive plays', success_rate: 'Success Rate', red_zone: 'Red zone', late_downs: 'Late downs',
};

export const edgeLabel = (edge: string): string => LABELS[edge] ?? edge.replace(/_/g, ' ');

/** True for an edge whose sides' values are a rate (shown as a percentage), not points. */
export const isRateEdge = (edge: string): boolean => edge === 'success_rate';

export interface StoryView {
    decided: boolean
    winnerId: number | null
    loserId: number | null
    margin: number
    edges: StoryEdge[]
    moment: StoryMoment | null
    periods: StoryPeriod[]
    /** each side's largest run, the winner's first (home first on a tie) */
    runs: StoryRun[]
    /** each side's top performer, the winner's first (home first on a tie) */
    performers: StoryPerformer[]
    /** football edges are expected points; basketball's are points */
    unitLabel: string
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * What the panel shows, or null when there is nothing to show: no story, or a story with no priced edge.
 * `epa` labels the unit for football.
 */
export function storyView(story: GameStory | null | undefined, epa: boolean): StoryView | null {
    if (!story?.summary) return null;
    const s = story.summary;
    const edges = [...(story.edges ?? [])].filter((e) => finite(e.points_worth)).sort((a, b) => a.rank - b.rank).slice(0, STORY_EDGES);
    if (!edges.length) return null;
    const first = s.decided && s.winner_team_id != null ? s.winner_team_id : s.home_team_id;
    const order = <T extends { team_id: number }>(rows: T[]) => [...rows].sort((a, b) => Number(b.team_id === first) - Number(a.team_id === first));
    return {
        decided: s.decided,
        winnerId: s.decided ? s.winner_team_id : null,
        loserId: s.decided ? s.loser_team_id : null,
        margin: s.margin,
        edges,
        moment: story.moment ?? null,
        periods: story.periods ?? [],
        runs: order(story.runs ?? []),
        performers: order(story.performers ?? []),
        unitLabel: epa ? 'EPA' : 'Pts',
    };
}
