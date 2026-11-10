// BB-G40: the game page's play-by-play controls behind 'bball-pbp-controls' -- event-type, team, period and player
// filters, a "big WP swings only" switch, the points and WPA columns beside home WP, and the `?order=` sort (newest first
// while live, oldest first otherwise). Real processor and Data API fixtures from all four leagues; flag off is the
// byte-identity snapshots' business (test/nba/byteIdentity.render.test.ts) plus the `?order=`-ignored check here.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';
import NbaPlaysTable from '../src/components/nba/game/NbaPlaysTable.astro';
import { fromDataApi, fromProcessor, type NbaGame } from '../src/resources/nbaGame';
import { BIG_SWING, isLiveGame, newestFirstFor, playControls, playKinds, PLAY_KINDS } from '../src/basketball/playControls';
import { isSettle } from '../src/nba/data/game';
import { FLAGS } from '../src/utils/features';
import type { BasketballLeague } from '../src/utils/league';

const read = (lg: string, name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${lg}/${name}.json`, import.meta.url)).toString());
const GAMES: [BasketballLeague, string][] = [['nba', '401766458'], ['wnba', '401736287'], ['mbb', '401744223'], ['wbb', '401805076']];
const proc = (lg: BasketballLeague, id: string) => fromProcessor(read(lg, `game_${id}_processor`), lg);

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = (game: NbaGame, search = '', on = true) => container.renderToString(NbaPlaysTable, {
    props: { game }, request: new Request(`https://gameonpaper.com/nba/game/${game.id}${search}`),
    locals: { preview: true, flagOverrides: { 'bball-pbp-controls': on } } as App.Locals,
});
const live = (g: NbaGame, period: number | null = 3): NbaGame => ({ ...g, status: { ...g.status, completed: false, name: 'STATUS_IN_PROGRESS', period } });
const periodsOf = (h: string) => [...h.matchAll(/<details[^>]*data-period="(\d+)"/g)].map((m) => Number(m[1]));
const firstText = (h: string) => h.match(/<tbody>\s*<tr[^>]*>\s*<td>[^<]*<\/td><td[^>]*>[^<]*<\/td><td>([^<]*)<\/td>/)?.[1];

describe('BB-G40 play-by-play controls', () => {
    test("'bball-pbp-controls' is a preview flag", () => { expect(FLAGS['bball-pbp-controls']).toBe('preview'); });

    test.each(GAMES)('%s %s: every event kind turns up, from the processor and the Data API alike', (lg, id) => {
        for (const game of [proc(lg, id), fromDataApi(read(lg, `game_${id}_api`), lg)]) {
            const c = playControls(game);
            // timeouts and the rest: every fixture is a whole game, so each kind is there
            expect(c.kinds.map((k) => k.kind)).toEqual(Object.keys(PLAY_KINDS));
            // a free throw is never a field goal; a substitution is nothing else
            for (const x of c.plays) {
                expect(x.kinds.includes('fg') && x.kinds.includes('ft')).toBe(false);
                if (x.kinds.includes('sub')) expect(x.kinds).toEqual(['sub']);
            }
            // the points column adds up to the last play's score
            const last = game.plays.at(-1)!;
            expect(c.plays.reduce((s, x) => s + x.homePts, 0)).toBe(last.homeScore);
            expect(c.plays.reduce((s, x) => s + x.awayPts, 0)).toBe(last.awayScore);
            // big swings: at the threshold, never a settle row; the WPA cell is blank on settle rows only
            expect(c.big).toBeGreaterThan(0);
            for (const x of c.plays) {
                if (x.big) expect(Math.abs(x.play.wpDelta!)).toBeGreaterThanOrEqual(BIG_SWING);
                if (isSettle(x.play)) { expect(x.big).toBe(false); expect(x.wpa).toBeNull(); } else expect(x.wpa).toBe(x.play.wpDelta);
            }
            // the player menu: box names, both sides, only players who appear in the plays
            expect(c.players.map((g) => g.side)).toEqual(['away', 'home']);
            const box = new Set([...game.home.players, ...game.away.players].map((r) => r.athlete_id));
            for (const g of c.players) for (const o of g.options) { expect(box.has(o.id)).toBe(true); expect(o.n).toBeGreaterThan(0); }
        }
    });

    test('event kinds read ESPN type text across feeds', () => {
        const p = (typeText: string, over: Record<string, unknown> = {}) => playKinds({ typeText, scoringPlay: false, shootingPlay: false, ...over } as any);
        expect(p('MadeFreeThrow', { shootingPlay: true, scoringPlay: true })).toEqual(['scoring', 'ft']);
        expect(p('Free Throw - 2 of 2', { shootingPlay: true })).toEqual(['ft']);
        expect(p('JumpShot', { shootingPlay: true, scoringPlay: true })).toEqual(['scoring', 'fg']);
        expect(p('Offensive Foul Turnover')).toEqual(['tov', 'foul']);
        expect(p('Steal')).toEqual(['tov']);
        expect(p('Dead Ball Rebound')).toEqual(['reb']);
        expect(p('OfficialTVTimeOut')).toEqual(['timeout']);
        expect(p('Defensive 3-Seconds Technical')).toEqual(['foul']);
        expect(p('End Period')).toEqual([]);
    });

    test('sort: newest first while live, oldest first otherwise; `?order=` overrides either way', () => {
        expect(newestFirstFor(false, null)).toBe(false);
        expect(newestFirstFor(true, null)).toBe(true);
        expect(newestFirstFor(false, 'newest')).toBe(true);
        expect(newestFirstFor(true, 'oldest')).toBe(false);
        expect(newestFirstFor(true, 'bogus')).toBe(true);
        // live as the header says it: in progress, halftime, between periods; never suspended, postponed or final
        const st = (name: string, completed = false) => ({ name, completed, period: 2, displayClock: null, detail: null });
        for (const n of ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD']) expect(isLiveGame(st(n))).toBe(true);
        for (const n of ['STATUS_SUSPENDED', 'STATUS_POSTPONED', 'STATUS_DELAYED']) expect(isLiveGame(st(n))).toBe(false);
        expect(isLiveGame(st('STATUS_FINAL', true))).toBe(false);
    });

    test.each(GAMES)('%s %s: the rendered table, in both orders, with the bar and the columns', async (lg, id) => {
        const game = proc(lg, id);
        const fin = await render(game);
        const n = new Set(game.plays.map((p) => p.period)).size;
        expect(periodsOf(fin)).toEqual([...Array(n)].map((_, i) => i + 1));
        expect(fin).toContain('data-pbp-controls');
        expect(fin).toContain('>WPA</abbr>');
        expect(fin).toMatch(/<th scope="col" class="text-end">Points<\/th>/);
        expect(fin).toContain('Big WP swings only');
        expect(fin).toContain('href="?order=newest#plays"');
        expect(firstText(fin)).toBe(game.plays[0].text.replace(/&/g, '&amp;').replace(/</g, '&lt;') || undefined);
        // every play renders once, with its filter keys
        expect([...fin.matchAll(/<tr [^>]*data-k[ =>]/g)].length).toBe(game.plays.length);
        // the team menu's values are the plays' team ids (header ids and pbp ids are one space), and each row carries its own
        for (const t of [game.home.team.id, game.away.team.id]) expect(fin).toContain(`<option value="${t}">`);
        const teams = [...fin.matchAll(/<tr [^>]*?data-team(?:="(\d+)")?[ >]/g)].map((m) => m[1] ?? '');
        expect(teams).toEqual(game.plays.map((p) => (p.teamId == null ? '' : String(p.teamId))));
        expect(new Set(teams.filter(Boolean))).toEqual(new Set([game.home.team.id, game.away.team.id]));
        const newest = await render(game, '?order=newest');
        expect(periodsOf(newest)).toEqual(periodsOf(fin).reverse());
        expect(newest).toContain('href="?order=oldest#plays"');
        // live: newest first and the current period open, earlier ones collapsed
        const lv = await render(live(game, 2));
        expect(periodsOf(lv)[0]).toBe(n);
        expect([...lv.matchAll(/<details( open)? data-period="(\d+)"/g)].filter((m) => m[1]).map((m) => Number(m[2])).every((q) => q >= 2)).toBe(true);
        // a suspended game with plays is not live: oldest first, every period open
        const sus = await render({ ...live(game, 2), status: { ...live(game, 2).status, name: 'STATUS_SUSPENDED' } });
        expect(periodsOf(sus)).toEqual(periodsOf(fin));
        expect([...sus.matchAll(/<details( open)? data-period/g)].every((m) => m[1])).toBe(true);
    });

    test('a scoring row reads its points by side; a settle row has no WPA', async () => {
        const game = proc('nba', '401766458');
        const html = await render(game);
        // every row's points cell against the score columns: away first, each side by its own abbreviation
        const cells = [...html.matchAll(/<td class="text-end text-nowrap numeral">([^<]*)<\/td>/g)].map((m) => m[1]);
        let prev = { h: 0, a: 0 };
        const side = (n: number, t: string) => (n ? [`${n > 0 ? '+' : '−'}${Math.abs(n)} ${t}`] : []);
        const want = game.plays.map((p) => { const d = { h: p.homeScore - prev.h, a: p.awayScore - prev.a }; prev = { h: p.homeScore, a: p.awayScore }; return [...side(d.a, 'ATL'), ...side(d.h, 'ORL')].join(', '); });
        expect(cells).toEqual(want);
        // and a known play: the first ATL three is "+3 ATL", never ORL
        const three = game.plays.findIndex((p, i) => p.awayScore - (game.plays[i - 1]?.awayScore ?? 0) === 3);
        expect(cells[three]).toBe('+3 ATL');
        const end = game.plays.find((p) => p.typeText === 'End Game')!;
        expect(end.wpDelta).not.toBeNull(); // the settle: a delta the cell must not show
        const row = [...html.matchAll(/<tr [^>]*data-k[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]).find((r) => r.includes(`<td>${end.text}</td>`))!;
        expect(row).toMatch(/<td class="text-end numeral">–<\/td>\s*$/);
    });

    test('no plays: the plain note, no bar', async () => {
        const game = { ...proc('nba', '401766458'), plays: [] };
        const html = await render(game);
        expect(html).toContain('No plays yet.');
        expect(html).not.toContain('data-pbp-controls');
    });

    test('flag off: no bar, no new columns, and `?order=` changes nothing', async () => {
        const game = proc('nba', '401766458');
        const off = await render(game, '', false);
        expect(off).not.toContain('data-pbp-controls');
        expect(off).not.toContain('WPA');
        expect(await render(game, '?order=newest', false)).toBe(off);
        expect(await render(live(game), '?order=oldest', false)).toBe(await render(live(game), '', false));
    });
});
