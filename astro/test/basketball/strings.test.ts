// astro/test/basketball/strings.test.ts
// The basketball components may name a league only through the config. A literal '/nba', "'NBA'", 'stats.nba.com' or
// a Nets constant in these files is a page that would render NBA text for another league.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const FILES = [
    'components/routes/NbaHomeRoute.astro', 'components/routes/NbaPlayersRoute.astro', 'components/routes/NbaPlayerRoute.astro',
    'components/routes/NbaTeamsRoute.astro', 'components/routes/NbaTeamRoute.astro', 'components/routes/NbaScatterRoute.astro',
    'components/routes/NbaLeadersRoute.astro', 'components/routes/NbaScoreboardRoute.astro', 'components/nba/NbaSeasonSelect.astro',
    'components/nba/NbaTeamSelect.astro', 'components/nba/NbaPlayerTable.astro', 'components/nba/NbaRosterTable.astro',
    'components/nba/NbaRankLists.astro', 'components/nba/NbaGameCard.astro', 'components/nba/game/NbaGamePage.astro',
    'components/nba/game/NbaPreGamePage.astro', 'components/nba/game/NbaGameHeader.astro',
];
const BANNED = [/['"`]\/nba[/'"`?]/, /title: 'NBA'/, /`NBA /, /stats\.nba\.com/, /NETS_TEAM_ID/, /netsTricode/, /'1997-10-01'/, /league="nba"/];

describe('basketball components name the league only through the config', () => {
    for (const f of FILES) test(f, () => {
        const src = readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
        for (const re of BANNED) expect(src, `${f} matches ${re}`).not.toMatch(re);
    });
});
