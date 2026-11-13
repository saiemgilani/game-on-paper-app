// sdv-py's live NBA/WNBA source (source="live") is not in the deployed pin until sportsdataverse-py#1070 merges, so
// every `live` payload in these tests is a MOCK: the real ESPN processor fixture with a few numbers moved and the
// `provenance` block python/app.py `_provenance` adds to any `?source=` response.
import { readFileSync } from 'node:fs';

export const procJson = () => JSON.parse(readFileSync(new URL('../fixtures/nba/game_401766458_processor.json', import.meta.url)).toString());

/** What `?source=live` would answer: a different feed's numbers for the same game (or ESPN's, failed over). */
export function mockLive(over: { fallback?: boolean } = {}) {
    const j = procJson();
    if (!over.fallback) {
        j.header.competitions[0].competitors.find((c: any) => c.homeAway === 'home').score = '118';
        j.teams.home.box.field_goals_made = 43;
        j.teams.home.rates.efg_pct = 0.53;
        j.plays = j.plays.slice(0, 490);
    }
    j.provenance = { source: over.fallback ? 'espn' : 'live', requested: 'live', fallback_used: !!over.fallback, contract_version: '0.1.0', contract_sha: 'abcdef1234567' };
    return j;
}
