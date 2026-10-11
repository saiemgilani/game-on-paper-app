import { afterEach, expect, test, vi } from 'vitest';
import { retrieveGameSummary } from '../../src/resources/espn';

afterEach(() => vi.unstubAllGlobals());
const urlFor = async (...a: Parameters<typeof retrieveGameSummary>) => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await retrieveGameSummary(...a);
    return String((f.mock.calls[0] as unknown[])[0]);
};

test('the summary URL follows the league sport, and the football URLs are unchanged', async () => {
    expect(await urlFor(7, 'nba')).toBe('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=7');
    expect(await urlFor(7, 'nfl')).toBe('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=7');
    expect(await urlFor(7)).toBe('https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=7');
});
