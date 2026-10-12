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

test('a caller-supplied signal reaches the fetch; with none, football passes no signal', async () => {
    const f = vi.fn(async (..._a: unknown[]) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const sig = AbortSignal.timeout(3000);
    await retrieveGameSummary(7, 'nba', sig);
    expect((f.mock.calls[0][1] as RequestInit).signal).toBe(sig);
    await retrieveGameSummary(7, 'nfl');
    expect((f.mock.calls[1][1] as RequestInit).signal).toBeUndefined();
});
test('an aborted summary read resolves to null instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    expect(await retrieveGameSummary(7, 'nba', AbortSignal.timeout(3000))).toBeNull();
});
