import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/nba/scoreboard', () => ({ prepareNbaScoreboard: (...a: unknown[]) => prep(...a) }));

import Page from '../../src/pages/nba/scoreboard.astro';

const team = (abbr: string, id: string, score = abbr === 'ORL' ? '120' : '95') => ({ id, homeAway: abbr === 'ORL' ? 'home' : 'away', score, winner: abbr === 'ORL',
    team: { id, abbreviation: abbr, displayName: abbr, location: abbr, name: abbr }, records: [{ summary: '41-41', type: 'total' }],
    leaders: [{ name: 'points', leaders: [{ displayValue: '26', athlete: { shortName: 'C. Anthony' } }] }, { name: 'rebounds', leaders: [{ displayValue: '13', athlete: { shortName: 'F. Wagner' } }] }] });
const game = (id: string, name: string, period = 4, clock = '0.0', state = 'post', score?: string) => {
    const status = { period, displayClock: clock, clock: 0, type: { id: '3', name, state, completed: name === 'STATUS_FINAL', description: 'Final', detail: name === 'STATUS_DELAYED' ? 'Delayed' : 'Final', shortDetail: 'Final' } };
    return { id, date: '2025-04-15T23:30Z', shortName: 'ATL @ ORL',
        competitions: [{ id, date: '2025-04-15T23:30Z', competitors: [team('ORL', '19', score), team('ATL', '1', score)], status, broadcasts: [] }], status };
};
const base = { day: '2025-04-15', isLive: false, degraded: false, stale: false, nav: { prev: '2025-04-14', next: '2025-04-16', label: 'Tuesday, April 15' }, today: '2026-10-21' };

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = async () => container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/scoreboard'), locals: { preview: true, league: 'nba' } as App.Locals });

describe('/nba/scoreboard render', () => {
    test('a final game: both teams, bold winner, Final, leaders, a link to the game page', async () => {
        prep.mockResolvedValueOnce({ ...base, games: [game('401766458', 'STATUS_FINAL')] });
        const html = await render();
        expect(html).toContain('href="/nba/game/401766458"');
        expect(html).toContain('<strong>120</strong>');
        expect(html).toContain('Final');
        expect(html).toContain('26 C. Anthony');
        expect(html).toContain('PTS, 13 F. Wagner REB');
        expect(html).not.toContain(' · ');
        expect(html).toContain('Tuesday, April 15');
        expect(html).toContain('href="/nba/scoreboard?date=2025-04-14"');
        expect(html).toContain('href="/nba/scoreboard?date=2025-04-16"');
        expect(html).toContain('type="date"');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    });
    test('a live game shows the period and clock; a scheduled one its tip time in the viewer zone', async () => {
        prep.mockResolvedValueOnce({ ...base, isLive: true, games: [game('1', 'STATUS_IN_PROGRESS', 3, '4:12', 'in'), game('2', 'STATUS_SCHEDULED', 0, '12:00', 'pre', '0')] });
        const html = await render();
        expect(html).toContain('Q3 4:12');
        expect(html).toContain('data-gb-utc="2025-04-15T23:30Z"');
        expect(html).toContain('Tonight');
        expect(html).toContain('Preview');
    });
    test('a mid-game delay still reads live; a pre-game delay previews and prints no 0-0', async () => {
        prep.mockResolvedValueOnce({ ...base, games: [game('7', 'STATUS_DELAYED', 2, '5:00', 'in')] });
        let html = await render();
        expect(html).toContain('border-primary');
        expect(html).toContain('>Stats<');
        prep.mockResolvedValueOnce({ ...base, games: [game('8', 'STATUS_DELAYED', 0, '12:00', 'pre', '0')] });
        html = await render();
        expect(html).not.toContain('border-primary');
        expect(html).toContain('>Preview<');
        expect(html).toMatch(/<strong hidden[^>]*>/);
    });
    test('a stale board with games shows the notice, never Tonight', async () => {
        prep.mockResolvedValueOnce({ ...base, stale: true, games: [game('4', 'STATUS_FINAL')] });
        const html = await render();
        expect(html).toContain('Live scores are temporarily unavailable');
        expect(html).toContain('last saved scores for Tuesday, April 15');
        expect(html).not.toMatch(/<h1[^>]*>Tonight/);
    });
    test('the date picker max is not below a future day value', async () => {
        prep.mockResolvedValueOnce({ ...base, day: '2026-10-25', games: [] });
        const html = await render();
        const max = /type="date"[^>]*max="(\d{4}-\d{2}-\d{2})"/.exec(html)![1];
        expect(max >= '2026-10-25').toBe(true);
    });
    test('an empty day says so and keeps the navigation', async () => {
        prep.mockResolvedValueOnce({ ...base, games: [] });
        const html = await render();
        expect(html).toContain('No games scheduled');
        expect(html).toContain('href="/nba/scoreboard?date=2025-04-16"');
    });
    test('a degraded day says the scoreboard is unavailable', async () => {
        prep.mockResolvedValueOnce({ ...base, degraded: true, stale: true, games: [] });
        expect(await render()).toContain('scoreboard is unavailable');
    });
    test('a bad date renders the error page', async () => {
        prep.mockResolvedValueOnce({ badDate: 'calendar' });
        expect(await render()).toContain('not a date we can show');
    });
    test('a competitor without leaders renders without them', async () => {
        const g = game('3', 'STATUS_FINAL'); for (const c of g.competitions[0].competitors) delete (c as any).leaders;
        prep.mockResolvedValueOnce({ ...base, games: [g] });
        const html = await render();
        expect(html).toContain('href="/nba/game/3"');
        expect(html).not.toContain('undefined');
    });
});
