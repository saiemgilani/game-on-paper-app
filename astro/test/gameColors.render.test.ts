import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { adjustTeamColorsForContrast, pickGameColors, rgbToHex } from '../src/utils/misc';

// 'game-colours': the game page decides the team colours ONCE and every chart
// paints that pair. Before it, the drive chart painted ESPN's raw colours while
// the WP/EP charts each ran their own contrast rule, so one game could show two
// different colourings of the same team.
const GAME_ID = 401729745;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString();
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (!String(url).includes(`/cfb/${GAME_ID}/process`)) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(apiPayload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
}));

// Astro serialises each island prop as a [type, value] pair: 0 = value/object, 1 = array.
const decode = (v: any): any => {
    if (!Array.isArray(v)) return v;
    const [t, x] = v;
    if (t === 1) return x.map(decode);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, w]) => [k, decode(w)]));
    return x;
};
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function islands(html: string, component: string): any[] {
    return [...html.matchAll(/<astro-island\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => tag.includes(`/${component}.svelte"`))
        .map((tag) => decode([0, JSON.parse(unescape(tag.match(/\sprops="([^"]*)"/)![1]))]));
}
// island uids are random per render and component urls carry the checkout's
// absolute path; nothing else in the document varies between runs
const ASTRO_DIR = new URL('..', import.meta.url).pathname;
const normalise = (html: string) => html.replace(/\suid="[^"]*"/g, ' uid=""').split(ASTRO_DIR).join('');
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const TWINS = {
    v2: () => import('../src/components/game/GamePage.astro'),
    classic: () => import('../src/components/game/classic/GamePage.astro'),
} as const;

let container: AstroContainer;
let game: any;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    const { retrieveProcessedGame } = await import('../src/resources/python');
    game = await retrieveProcessedGame(GAME_ID, 30);
}, 60_000);

async function render(twin: keyof typeof TWINS, locals: Record<string, unknown>) {
    const { default: Page } = await TWINS[twin]();
    return container.renderToString(Page, {
        props: { id: GAME_ID, game: structuredClone(game) },
        request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
        locals: locals as any,
    });
}

describe.each(Object.keys(TWINS) as (keyof typeof TWINS)[])('%s game page, game-colours on', (twin) => {
    let html = '';
    beforeAll(async () => { html = await render(twin, { flagOverrides: { 'game-colours': true } }); }, 60_000);

    test('the WP chart, the EP chart and every drive chart get the same light and dark pairs', () => {
        const expected = pickGameColors(game.teamInfo.home, game.teamInfo.away);
        expect(expected.light).not.toEqual(expected.dark);   // this fixture exercises both pairs
        const [wp] = islands(html, 'WinProbabilityChart');
        const [ep] = islands(html, 'ExpectedPointsChart');
        expect(wp.colors).toEqual(expected);
        expect(ep.colors).toEqual(expected);

        // the drive chart takes plain colour strings (#276): the light pair, plus
        // the dark pair it switches to; the subtitle opens with the offense
        const drives = islands(html, 'DriveChart');
        expect(drives.length).toBeGreaterThan(10);
        const offenseSide = (d: any) => (d.subtitle.startsWith(`${game.teamInfo.home.abbreviation} - `) ? 'home' : 'away');
        const other = { home: 'away', away: 'home' } as const;
        const seen = new Set<string>();
        for (const d of drives) {
            const off = offenseSide(d);
            seen.add(off);
            expect(d.offenseColor).toBe(expected.light[off]);
            expect(d.defenseColor).toBe(expected.light[other[off]]);
            expect(d.darkOffenseColor).toBe(expected.dark[off]);
            expect(d.darkDefenseColor).toBe(expected.dark[other[off]]);
            expect(d.offense ?? d.defense ?? d.colors).toBeUndefined();
        }
        expect(seen.size).toBe(2);
    });
});

describe('Deserved Win % bars switch pair with prefers-color-scheme', () => {
    // the fixture game has no paperIndex, so the panel is rendered on its own
    const result = { homeShare: 0.62, margins: { success: 0.06 } };
    const renderPanel = async (colors?: ReturnType<typeof pickGameColors>) => {
        const { default: PaperIndex } = await import('../src/components/game/metrics/PaperIndex.astro');
        return container.renderToString(PaperIndex, {
            props: { result, homeTeam: game.teamInfo.home, awayTeam: game.teamInfo.away, completed: true, ...(colors ? { colors } : {}) },
        });
    };

    test('with the flag, the bars read custom properties set per theme', async () => {
        const colors = pickGameColors(game.teamInfo.home, game.teamInfo.away);
        const html = await renderPanel(colors);
        expect(html).toContain(`#paper-index-panel { --pi-home: ${colors.light.home}; --pi-away: ${colors.light.away}; }`);
        expect(html).toContain(`@media (prefers-color-scheme: dark) { #paper-index-panel { --pi-home: ${colors.dark.home}; --pi-away: ${colors.dark.away}; } }`);
        expect(html).toContain('background-color: var(--pi-away)');
        expect(html).toContain('background-color: var(--pi-home)');
    });

    test('without it, the bars keep the pair adjusted for contrast (#270)', async () => {
        const html = await renderPanel();
        const [away, home] = adjustTeamColorsForContrast(game.teamInfo.away, game.teamInfo.home);
        expect(html).not.toContain('--pi-');
        expect(html).toContain(`background-color: ${rgbToHex(home)}`);
        expect(html).toContain(`background-color: ${rgbToHex(away)}`);
    });
});

describe('game-colours off: the page is byte-for-byte what main renders', () => {
    // Hashes of the flag-off render of this fixture on #270's tree before 'game-colours'
    // existed (AE/design-fixes + main 4a62cc2a = be3b1082, same body, run there); the
    // merged tree renders the same bytes. The flag's
    // only footprint is the `colors` / dark drive-colour props, absent when it is off. Another
    // PR that changes the game page moves these on purpose: re-run with
    // PRINT_GOLDEN=1 and paste. Delete this block when the flag is promoted.
    const GOLDEN = { v2: '2770fa581743a4e6', classic: '300050d1e982de62' };

    test.each(Object.keys(TWINS) as (keyof typeof TWINS)[])('%s', async (twin) => {
        const html = await render(twin, {});
        expect(html).not.toMatch(/&quot;(colors|darkOffenseColor|darkDefenseColor)&quot;/);
        if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${twin} ${sha(normalise(html))}`);
        expect(sha(normalise(html))).toBe(GOLDEN[twin]);
    }, 60_000);
});
