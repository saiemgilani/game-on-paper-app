// WinProbabilityChart is client:only, so render tests never run its markup. Compile the real component for the server
// and render it with the browser-only imports stubbed, to pin the text around the odds line and the download link.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';

const SV = join(process.cwd(), 'node_modules/svelte');
const stub = `const cleanAbbreviation=t=>t.abbreviation, roundNumber=(v)=>String(v), getNumberWithOrdinal=n=>n+'th', translateValue=x=>x, getCurrentViewport=()=>'lg', adjustTeamColorsForContrast=()=>[[0,0,0],[1,1,1]], hexToRgb=x=>x, waitForElement=async()=>{}, leagueFromLocation=()=>'cfb', teamLogoUrl=()=>''; const SPECIAL_IMAGES={}, SPECIAL_IMAGES_DARK={}; const GradientFillLineController={}; const LineController={}; const Chart={getChart(){}};\n`;
let renderChart: (props: Record<string, unknown>) => string;
beforeAll(async () => {
    const { compile } = await import(pathToFileURL(join(SV, 'src/compiler/index.js')).href);
    const { render } = await import(pathToFileURL(join(SV, 'src/server/index.js')).href);
    (globalThis as any).document = { readyState: 'loading', addEventListener() {}, getElementById: () => null };
    (globalThis as any).window = { matchMedia: () => ({ addEventListener() {} }) };
    const src = readFileSync(new URL('../../src/components/charts/WinProbabilityChart.svelte', import.meta.url), 'utf8');
    let js: string = compile(src, { generate: 'server', filename: 'WinProbabilityChart.svelte' }).js.code;
    js = js.replace(/^import\s+[\w*{}\s,$]+?\s+from\s+['"](chart\.js[^'"]*|\.\.[^'"]*)['"];?/gm, '');
    const href = (f: string) => pathToFileURL(join(SV, f)).href;
    js = js.replace(/(['"])svelte\/internal\/server\1/g, `'${href('src/internal/server/index.js')}'`)
        .replace(/(['"])svelte\/internal\/disclose-version\1/g, `'${href('src/internal/disclose-version.js')}'`)
        .replace(/(['"])svelte\/internal\/flags\/([\w-]+)\1/g, (_m, _q, f) => `'${href(`src/internal/flags/${f}.js`)}'`);
    const file = join(mkdtempSync(join(tmpdir(), 'wpchart-')), 'chart.mjs');
    writeFileSync(file, js + '\n' + stub);
    const Comp = (await import(/* @vite-ignore */ pathToFileURL(file).href)).default;
    renderChart = (props) => render(Comp, { props }).body.replace(/<!--[^>]*-->/g, '').replace(/\s+/g, ' ');
});
const team = (id: string, abbreviation: string) => ({ id, abbreviation });
const props = (o: { completed: boolean; wp?: number; extra?: Record<string, unknown> }) => ({
    id: 'g1', homeComp: { team: team('1', 'HOM') }, awayComp: { team: team('2', 'AWY') }, homeTeamSpread: 3.5, overUnder: 51.5, percentiles: [], gei: 3.2,
    gameStatus: { type: { completed: o.completed, name: o.completed ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS' } },
    plays: [1, 2, 3, 4].map((p, i) => ({ period: p, pos_team: i % 2 ? '1' : '2', gameSpreadAvailable: true, winProbability: { before: o.wp ?? 0.6 } })), ...o.extra,
});

describe('WinProbabilityChart server markup', () => {
    test('football (showOdds default): odds and GEI text, then "| " right before the Download link', () => {
        const h = renderChart(props({ completed: true }));
        expect(h).toContain('Game Excitement Index:');
        expect(h).toMatch(/O\/U 51\.5 \| <a id="wp-download"/);
        expect(h).toContain('<h2 class="mb-0">Win Probability</h2>');
    });
    test('showOdds=false: no odds, GEI, default-odds text, NaN or h2; just the download link', () => {
        const h = renderChart(props({ completed: true, extra: { showOdds: false, overUnder: null, gei: null, homeTeamSpread: 0 } }));
        for (const bad of ['Odds:', 'Game Excitement', '-2.5', 'O/U', 'NaN', 'PUSH', '<h2']) expect(h).not.toContain(bad);
        expect(h).toContain('<a id="wp-download"');
        expect(h).not.toMatch(/\| <a id="wp-download"/);
    });
    test('a live NBA game reads "Current: … | Download"', () => {
        const h = renderChart(props({ completed: false, wp: 0.7, extra: { showOdds: false, overUnder: null, gei: null } }));
        expect(h).toMatch(/Current: \w+ [\d.]+% \| <a id="wp-download"/);
        expect(h).not.toContain('Odds:');
    });
});
