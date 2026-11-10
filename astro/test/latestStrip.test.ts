// BB-G41: the live game page's Latest strip, behind 'bball-latest-strip'. Real processor payloads from each league
// (test/fixtures/<league>/game_*_processor.json), cut part-way through and marked in progress as a live render would
// see them. No network: the page is rendered from the payload, with no route and no read.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { fromProcessor, type NbaGame } from '../src/resources/nbaGame';
import { isLiveGame, latestStrip, RECENT_SHOTS } from '../src/basketball/latest';
import { FLAGS } from '../src/utils/features';

type League = 'nba' | 'wnba' | 'mbb' | 'wbb';
const raw = (league: League, id: string) => JSON.parse(readFileSync(new URL(`./fixtures/${league}/game_${id}_processor.json`, import.meta.url)).toString());
const GAMES: Record<League, string> = { nba: '401766458', wnba: '401736289', mbb: '401808271', wbb: '401805076' };
const final = (league: League, id = GAMES[league]) => fromProcessor(raw(league, id), league);
/** The same game with only its first `share` of plays, in progress in the last play's period. */
const live = (league: League, id = GAMES[league], share = 0.6, name = 'STATUS_IN_PROGRESS'): NbaGame => {
    const g = final(league, id);
    const plays = g.plays.slice(0, Math.round(g.plays.length * share));
    return { ...g, plays, status: { ...g.status, name, completed: false, period: plays.at(-1)!.period, displayClock: plays.at(-1)!.clock, detail: 'live' } };
};

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const page = (game: NbaGame, league: League, flag?: boolean) => container.renderToString(NbaGamePage, { props: { game }, locals: { league, preview: true, ...(flag === undefined ? {} : { flagOverrides: { 'bball-latest-strip': flag } }) } as App.Locals });
const strip = (html: string) => html.split('id="latest"')[1]?.split('id="wp"')[0] ?? '';

describe('latestStrip', () => {
    test("'bball-latest-strip' is a preview flag", () => { expect(FLAGS['bball-latest-strip']).toBe('preview'); });
    test('live: in progress, halftime and end of period; never a final, a suspended or a delayed game', () => {
        const s = final('nba').status;
        for (const name of ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD']) expect(isLiveGame({ ...s, name, completed: false })).toBe(true);
        for (const name of ['STATUS_SUSPENDED', 'STATUS_DELAYED', 'STATUS_POSTPONED']) expect(isLiveGame({ ...s, name, completed: false })).toBe(false);
        expect(isLiveGame({ ...s, name: 'STATUS_IN_PROGRESS', completed: true })).toBe(false);
        expect(latestStrip(final('nba'))).toBeNull();
        expect(latestStrip({ ...live('nba'), plays: [] })).toBeNull();
    });
    for (const league of ['nba', 'wnba', 'mbb', 'wbb'] as League[]) {
        test(`${league}: the last five plays newest first, the last ${RECENT_SHOTS} located shots newest first`, () => {
            const g = live(league);
            const l = latestStrip(g)!;
            expect(l.plays).toEqual(g.plays.slice(-5).reverse());
            const located = g.plays.filter((p) => p.xLegacy != null && p.yLegacy != null);
            expect(l.shots.map((s) => s.play)).toEqual(located.slice(-RECENT_SHOTS).reverse());
            expect(l.shots.map((s) => s.age)).toEqual(l.shots.map((_, i) => i));
            for (const s of l.shots) expect(s.home).toBe(s.play.teamId === Number(g.home.team.id));
            expect(new Set(l.shots.map((s) => s.home)).size).toBe(2); // both teams on the court
        });
    }
    test("college: a field goal ESPN put at the rim as its 'no location' is not drawn (mbb 401706366: every one)", () => {
        const g = live('mbb', '401706366');
        expect(g.plays.some((p) => p.xLegacy === 0 && p.yLegacy === 0)).toBe(true);
        expect(latestStrip(g, true)!.shots).toEqual([]);
        expect(latestStrip(g, true)!.plays).toHaveLength(5); // the plays still list
        expect(latestStrip(g, false)!.shots.length).toBe(RECENT_SHOTS);
    });
});

describe('the game page', () => {
    for (const league of ['nba', 'wnba', 'mbb', 'wbb'] as League[]) {
        test(`${league} live, flag on: the Latest panel first, its nav item, five rows and a faded court`, async () => {
            const g = live(league);
            const html = await page(g, league);
            expect(html.indexOf('id="latest"')).toBeGreaterThan(-1);
            expect(html.indexOf('id="latest"')).toBeLessThan(html.indexOf('id="wp"'));
            expect(html).toContain('href="#latest"');
            const s = strip(html);
            expect(s.split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g)).toHaveLength(5);
            expect(s).toContain(g.plays.at(-1)!.text.replace(/&/g, '&amp;').replace(/'/g, '&#39;'));
            const shots = latestStrip(g, league === 'mbb' || league === 'wbb')!.shots;
            expect(s.match(/<g opacity=/g)?.length).toBe(shots.length);
            expect(s).toContain('opacity="1"'); // the newest, ringed
            expect(s).toContain('opacity="0.3"'); // the eighth, faded (1 - 0.75 * 7/7, rounded)
            expect(s).toContain(`The last ${shots.length} located shots`);
            expect(s).not.toMatch(/NaN|undefined|Infinity/);
        });
    }
    test('flag off, a live game: no panel and no nav item', async () => {
        const html = await page(live('nba'), 'nba', false);
        expect(html).not.toContain('id="latest"');
        expect(html).not.toContain('href="#latest"');
    });
    test('a final with the flag on renders byte for byte as with it off; so does a suspended game', async () => {
        for (const g of [final('nba'), live('nba', GAMES.nba, 0.6, 'STATUS_SUSPENDED')]) {
            const on = await page(g, 'nba', true);
            expect(on).not.toContain('id="latest"');
            expect(on).toBe(await page(g, 'nba', false));
        }
    });
    test('halftime: the strip shows, with a missing WP as a dash', async () => {
        const g = live('wnba', GAMES.wnba, 0.5, 'STATUS_HALFTIME');
        g.plays[g.plays.length - 1] = { ...g.plays.at(-1)!, homeWinProb: null, wpDelta: null };
        const s = strip(await page(g, 'wnba'));
        expect(s.split('<tbody>')[1].split('</tr>')[0]).toContain('<td class="text-end">–</td><td class="text-end">–</td>');
    });
});
