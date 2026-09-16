/**
 * Head-coach tendency boards: which columns each board shows, how a value is
 * formatted, and the pure sorting/ranking/qualification steps the tables use.
 *
 * The three tables (`team_tendencies`, `coach_tendencies`, `coach_careers`)
 * share one metric vocabulary, so a board definition serves the season pages
 * and the careers page alike. Rates are 0-1 fractions; the three columns in
 * percentage POINTS (`third_down_over_expected`, `fourth_wp_left*`) carry a
 * numeric format, which the fixture-backed test pins so a builder change that
 * moves a column between the two conventions fails loudly.
 */

export type CoachColumnFormat = 'pct' | 'num1' | 'num2' | 'int';

export interface CoachBoardColumn {
    key: string;
    label: string;
    /** the <abbr title> explaining the number */
    hover: string;
    format: CoachColumnFormat;
    /** rank 1 is the smallest value (pace, WP left, everything a defense allows) */
    lowerIsBetter?: boolean;
}

export interface CoachBoard {
    slug: string;
    title: string;
    /** column key the board opens sorted by */
    defaultSort: string;
    columns: CoachBoardColumn[];
}

export type CoachRow = Record<string, string | number | null | undefined>;

const pct = (key: string, label: string, hover: string, lowerIsBetter = false): CoachBoardColumn => ({ key, label, hover, format: 'pct', lowerIsBetter });
const num = (key: string, label: string, hover: string, format: 'num1' | 'num2', lowerIsBetter = false): CoachBoardColumn => ({ key, label, hover, format, lowerIsBetter });

const NEUTRAL = 'win probability between 20% and 80%, in regulation, outside the last two minutes of a half';

export const COACH_BOARDS: Record<string, CoachBoard> = {
    pace: {
        slug: 'pace',
        title: 'Pace',
        defaultSort: 'sec_per_play',
        columns: [
            num('sec_per_play', 'Sec/Play', 'Seconds of game clock per offensive play, over drives with a clock; lower is faster', 'num1', true),
            num('sec_per_play_neutral', 'Neutral Sec/Play', `Seconds of game clock per offensive play in situation-neutral snaps (${NEUTRAL}); lower is faster`, 'num1', true),
            num('plays_per_game', 'Plays/Game', 'Offensive plays per game', 'num1'),
            num('plays_per_drive', 'Plays/Drive', 'Offensive plays per drive', 'num2'),
            num('drives_per_game', 'Drives/Game', 'Offensive drives per game', 'num1'),
            pct('pace_coverage', 'Clock Coverage', 'Share of drives with a usable game clock; the pace columns are blank when it is zero'),
        ],
    },
    tendencies: {
        slug: 'tendencies',
        title: 'Run/Pass',
        defaultSort: 'pass_rate_neutral',
        columns: [
            pct('pass_rate', 'Pass Rate', 'Share of offensive plays that were dropbacks'),
            pct('pass_rate_neutral', 'Neutral Pass Rate', `Situation-neutral pass rate: dropbacks per play when ${NEUTRAL}`),
            pct('pass_rate_early_down', 'Early Down', 'Pass rate on first and second down'),
            pct('pass_rate_d1', '1st Down', 'Pass rate on first down'),
            pct('pass_rate_d2', '2nd Down', 'Pass rate on second down'),
            pct('pass_rate_d3', '3rd Down', 'Pass rate on third down'),
            pct('pass_rate_leading', 'Leading', 'Pass rate while ahead on the scoreboard'),
            pct('pass_rate_tied', 'Tied', 'Pass rate while tied'),
            pct('pass_rate_trailing', 'Trailing', 'Pass rate while behind on the scoreboard'),
        ],
    },
    efficiency: {
        slug: 'efficiency',
        title: 'Efficiency',
        defaultSort: 'epa_per_play',
        columns: [
            num('epa_per_play', 'EPA/Play', 'Expected points added per offensive play', 'num2'),
            pct('success_rate', 'Success Rate', 'Share of plays with positive EPA'),
            pct('explosive_rate', 'Explosive Rate', 'Share of plays gaining a big chunk of EPA'),
            pct('explosive_rate_rush', 'Explosive Rush', 'Explosive rate on rushes'),
            pct('explosive_rate_pass', 'Explosive Pass', 'Explosive rate on dropbacks'),
            num('ypp', 'Yards/Play', 'Yards per offensive play', 'num1'),
            pct('third_down_rate', '3rd Down Conv', 'Share of third downs converted'),
            num('third_down_over_expected', '3rd Down Over Exp', 'Third-down conversions over what the distances to go would predict, in percentage points', 'num1'),
            num('pts_per_drive', 'Pts/Drive', 'Points per offensive drive', 'num2'),
        ],
    },
    scoring: {
        slug: 'scoring',
        title: 'Scoring',
        defaultSort: 'rz_td_rate',
        columns: [
            pct('rz_trip_rate', 'RZ Trip Rate', 'Share of drives that reached the red zone (inside the 20)'),
            pct('rz_td_rate', 'RZ TD Rate', 'Share of red-zone trips ending in a touchdown'),
            pct('rz_conversion_rate', 'RZ Score Rate', 'Share of red-zone trips ending in any score'),
            num('rz_pts_per_trip', 'RZ Pts/Trip', 'Points per red-zone trip', 'num2'),
            pct('so_trip_rate', 'SO Trip Rate', 'Share of drives that became a scoring opportunity (a snap inside the 40)'),
            pct('so_td_rate', 'SO TD Rate', 'Share of scoring opportunities ending in a touchdown'),
            pct('so_conversion_rate', 'SO Score Rate', 'Share of scoring opportunities ending in any score'),
            num('so_pts_per_trip', 'SO Pts/Trip', 'Points per scoring opportunity', 'num2'),
            num('scripted_epa_per_play', 'Scripted EPA/Play', 'EPA per play on the scripted drives (the first two of each half)', 'num2'),
            pct('scripted_success_rate', 'Scripted Success', 'Success rate on the scripted drives (the first two of each half)'),
            num('scripted_pts_per_drive', 'Scripted Pts/Drive', 'Points per drive on the scripted drives (the first two of each half)', 'num2'),
            num('non_scripted_epa_per_play', 'Unscripted EPA/Play', 'EPA per play on every drive after the scripted ones', 'num2'),
            num('non_scripted_pts_per_drive', 'Unscripted Pts/Drive', 'Points per drive after the scripted ones', 'num2'),
        ],
    },
    'fourth-downs': {
        slug: 'fourth-downs',
        title: 'Fourth Downs',
        defaultSort: 'go_rate',
        columns: [
            { key: 'fourth_decisions', label: 'Decisions', hover: 'Fourth downs where the model had a recommendation', format: 'int' },
            pct('go_rate', 'Go Rate', 'Share of fourth-down decisions where the offense went for it'),
            pct('fourth_agreement_rate', 'Model Agreement', 'Share of fourth-down decisions matching the win-probability model'),
            pct('go_rate_when_model_says_go', 'Went When Told Go', 'Go rate on the fourth downs where the model said go'),
            pct('go_rate_when_model_says_kick', 'Went When Told Kick', 'Go rate on the fourth downs where the model said kick or punt', true),
            pct('fourth_conversion_rate', 'Conversion Rate', 'Share of fourth-down attempts converted'),
            num('fourth_wp_left_per_decision', 'WP Left/Decision', 'Win probability left on the field per fourth-down decision, in percentage points; lower is better', 'num2', true),
            num('fourth_wp_left', 'Total WP Left', 'Win probability left on the field over every fourth-down decision, in percentage points; lower is better', 'num1', true),
        ],
    },
    defense: {
        slug: 'defense',
        title: 'Defense',
        defaultSort: 'def_epa_per_play',
        columns: [
            num('def_epa_per_play', 'EPA/Play Allowed', 'Expected points added per play by opposing offenses; lower is better', 'num2', true),
            pct('def_success_rate', 'Success Allowed', 'Opponent success rate; lower is better', true),
            pct('def_explosive_rate', 'Explosive Allowed', 'Opponent explosive-play rate; lower is better', true),
            pct('def_third_down_rate', '3rd Down Allowed', 'Opponent third-down conversion rate; lower is better', true),
            pct('def_rz_td_rate', 'RZ TD Allowed', 'Opponent red-zone touchdown rate; lower is better', true),
            pct('def_so_td_rate', 'SO TD Allowed', 'Opponent scoring-opportunity touchdown rate; lower is better', true),
            num('def_pts_per_drive', 'Pts/Drive Allowed', 'Points allowed per opponent drive; lower is better', 'num2', true),
        ],
    },
};

export const COACH_BOARD_SLUGS = Object.keys(COACH_BOARDS);
export const DEFAULT_COACH_BOARD = 'pace';

/** Rows with fewer plays sit below a divider, unranked: interim stints and partial seasons. */
export const COACH_MIN_PLAYS = { season: 300, careers: 1500 } as const;

/** Every metric column any board reads, once -- the `select` for the API calls. */
export function coachMetricColumns(): string[] {
    return [...new Set(Object.values(COACH_BOARDS).flatMap((b) => b.columns.map((c) => c.key)))];
}

/** The board for a slug, or undefined: an own-key lookup, so 'toString' is not a board. */
export function coachBoard(board: string | undefined): CoachBoard | undefined {
    return board !== undefined && Object.hasOwn(COACH_BOARDS, board) ? COACH_BOARDS[board] : undefined;
}

export function coachBoardColumn(board: string, key: string): CoachBoardColumn | undefined {
    return coachBoard(board)?.columns.find((c) => c.key === key);
}

/** The column to sort by: the `?sort=` value when the board has it, else the board's default. */
export function resolveCoachSort(board: string, sort: string | null | undefined): string {
    const b = coachBoard(board);
    if (!b) return '';
    return sort && b.columns.some((c) => c.key === sort) ? sort : b.defaultSort;
}

export function numericValue(row: CoachRow, key: string): number | null {
    const v = row[key];
    if (v === null || v === undefined || v === '' || v === 'NA') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

/** "—" for a missing value (pace columns when there is no clock), else the column's format. */
export function formatCoachValue(value: number | null | undefined, format: CoachColumnFormat): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    switch (format) {
        case 'pct': return `${(value * 100).toFixed(1)}%`;
        case 'num1': return value.toFixed(1);
        case 'num2': return value.toFixed(2);
        case 'int': return String(Math.round(value));
    }
}

/** Sort by a column: nulls last, descending unless the column says lower is better. Stable. */
export function sortCoachRows<T extends CoachRow>(rows: T[], column: CoachBoardColumn): T[] {
    const dir = column.lowerIsBetter ? 1 : -1;
    return rows
        .map((row, i) => ({ row, i, v: numericValue(row, column.key) }))
        .sort((a, b) => {
            if (a.v === null && b.v === null) return a.i - b.i;
            if (a.v === null) return 1;
            if (b.v === null) return -1;
            return (a.v - b.v) * dir || a.i - b.i;
        })
        .map((x) => x.row);
}

/**
 * Competition ranks ("1224") for already-sorted rows: equal values share the
 * rank, the next distinct value takes the position after them, nulls get none.
 */
export function rankCoachRows<T extends CoachRow>(sorted: T[], key: string): (number | null)[] {
    const ranks: (number | null)[] = [];
    let prev: number | null = null;
    let prevRank = 0;
    sorted.forEach((row, i) => {
        const v = numericValue(row, key);
        if (v === null) { ranks.push(null); return; }
        const rank = prev !== null && v === prev ? prevRank : i + 1;
        ranks.push(rank);
        prev = v;
        prevRank = rank;
    });
    return ranks;
}

/** Split rows at the plays floor; the partial rows keep their sort order but are never ranked. */
export function splitByMinPlays<T extends CoachRow>(rows: T[], minPlays: number): { qualified: T[]; partial: T[] } {
    const qualified: T[] = [];
    const partial: T[] = [];
    for (const r of rows) ((numericValue(r, 'plays') ?? 0) >= minPlays ? qualified : partial).push(r);
    return { qualified, partial };
}

/** "2019-2024 (6)" for a career row; a single season is just the year. */
export function formatSeasonSpan(row: CoachRow): string {
    const first = numericValue(row, 'first_season');
    const last = numericValue(row, 'last_season');
    const n = numericValue(row, 'seasons');
    if (first === null || last === null) return '—';
    const span = first === last ? `${first}` : `${first}–${last}`;
    return n !== null && n > 1 ? `${span} (${n})` : span;
}
