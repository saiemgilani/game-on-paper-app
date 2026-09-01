// Composes the play-mark sprite from vendored pro glyphs (glyphs.json carries sources + licenses:
// Material Symbols Apache-2.0, Phosphor MIT, Bootstrap Icons MIT -- nothing needs attribution)
// plus a few drawn primitives (goalposts, scrimmage bars, dots).
//   node scripts/play-marks/compose.mjs          -> writes src/components/game/plays/PlayMarkSprite.astro
//   node scripts/play-marks/compose.mjs --print  -> prints the sprite only (for previews)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { glyphs } = JSON.parse(readFileSync(join(here, 'glyphs.json'), 'utf8'));

/** Place a glyph in the 32-grid: x,y top-left, s rendered size. `tone` overrides --c (e.g. a red x on a green mark). */
function g(name, x, y, s, tone) {
    const { vb, d, evenodd } = glyphs[name];
    const [vx, vy, vw] = vb.split(' ').map(Number);
    const k = s / vw;
    const fill = tone ? `var(--mark-${tone})` : 'var(--c)';
    return `<path fill="${fill}"${evenodd ? ' fill-rule="evenodd"' : ''} transform="translate(${x} ${y}) scale(${k}) translate(${-vx} ${-vy})" d="${d}"/>`;
}
const F = 'fill="var(--c)"';
const posts = (x, w, h = 10) => `<path ${F} d="M${x} 3h3v${h}h${w}V3h3v${h + 3}h-${(w + 6) / 2 - 1.5}v${29 - (h + 3) - 3}h-3v-${29 - (h + 3) - 3}h-${(w + 6) / 2 - 1.5}Z"/>`;
const ball = (x, y, s) => g('m:sports_football', x, y, s);
const ok = g('m:check_circle', 21, 20, 11);
const bad = g('m:cancel', 21, 20, 11, 'turnover');

const SYMBOLS = {
    // turnovers
    int:        ball(12, 0, 20) + g('m:undo', 0, 12, 20),
    fumble:     ball(1, 6, 22) + g('m:priority_high', 19, 1, 14),
    downs:      ball(0, 10, 20) + g('m:block', 13, 0, 19),
    blocked:    g('m:pan_tool', 13, 1, 20) + ball(0, 12, 17),
    'fg-miss':  posts(3, 8) + ball(17, 0, 14) + g('m:close', 18, 15, 12),
    // scores; the conversion result rides on the touchdown mark
    td:         ball(0, 8, 22),
    'td-xp':    ball(0, 8, 22) + g('m:exposure_plus_1', 16, -1, 16) + ok,
    'td-xp-miss': ball(0, 8, 22) + g('m:exposure_plus_1', 16, -1, 16) + bad,
    'td-2pt':   ball(0, 8, 22) + g('m:exposure_plus_2', 16, -1, 16) + ok,
    'td-2pt-miss': ball(0, 8, 22) + g('m:exposure_plus_2', 16, -1, 16) + bad,
    fg:         posts(6, 14) + ball(8, -1, 16),
    safety:     `<mask id="pi-safety-m"><rect width="32" height="32" fill="#fff"/><path d="M11.5 12.5c0-2.8 2.2-4.5 4.8-4.5 2.7 0 4.7 1.7 4.7 4.2 0 2-1.4 3.3-3.4 5L15 19.5h6.2V22H11v-2.3l4.6-4.4c1.5-1.4 2.3-2.2 2.3-3.3 0-1-.8-1.7-1.9-1.7-1.2 0-2 .8-2.1 2.2Z" fill="#000"/></mask><g mask="url(#pi-safety-m)">${g('m:shield', 1, 1, 30)}</g>`,
    // defensive events
    // sack and tfl are text pills (PlayMarks.astro), not symbols
    stuffed:    g('p:person-simple-run', -2, 3, 24) + g('b:bricks', 19, 4, 13) + g('m:emergency', 13, 0, 9),
    'three-out': `<circle cx="3.5" cy="16" r="2.6" ${F}/><circle cx="10" cy="16" r="2.6" ${F}/><circle cx="16.5" cy="16" r="2.6" ${F}/>` + g('b:bricks', 19, 8, 13),
    'goal-line': posts(9, 14, 9).replace(F, 'fill="var(--c)" opacity=".45"') + g('b:bricks', 3, 17, 13) + g('b:bricks', 16, 17, 13) + g('b:sign-stop-fill', 2, 2, 12),
    // defensive 2-pt: the safety shield, coloured by .pi-def-2pt
    'def-2pt':  `<use href="#pi-safety" width="32" height="32"/>`,
    // 3rd down converted: the chain crew with a 3 in the down box; the chain
    // equipment (posts, links, turf) is neutral slate, box + ball carry the tone
    'third-conv': `<g><rect width="12" height="13" rx="1.8" fill="var(--c)"/><path d="M3.3 3.6c1.2-1.6 5.4-1.5 5.4.9 0 1.5-1.5 2.1-2.7 2.1 1.4 0 3 .7 3 2.4 0 2.6-4.4 2.8-5.9 1.3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".95"/></g>`
        + `<path d="M6 13.5V28M26 8V28" fill="none" stroke="var(--mark-stop)" stroke-width="3" stroke-linecap="round"/>`
        + Array.from({ length: 7 }, (_, i) => `<ellipse cx="${(7.8 + i * 2.8).toFixed(1)}" cy="25.5" rx="1.8" ry="1.1" fill="none" stroke="var(--mark-stop)" stroke-width="1.4"/>`).join('')
        + ball(15.5, 18.5, 15) + `<path fill="var(--mark-stop)" d="M1 28h30v2.6h-30Z"/>`,
    // 4th down converted: the chain crew -- down box (4) on the left post, the
    // full-span chain low, the ball spotted in front of it (round 14, FC-B)
    'fourth-conv': `<g><rect width="12" height="13" rx="1.8" fill="var(--c)"/><path fill="#fff" opacity=".95" transform="translate(1.6 1)" d="M6 1 1 8h4v3.4h2.9V8h2v-2.5h-2V1Z"/></g>`
        + `<path d="M6 13.5V28M26 8V28" fill="none" stroke="var(--mark-stop)" stroke-width="3" stroke-linecap="round"/>`
        + Array.from({ length: 7 }, (_, i) => `<ellipse cx="${(7.8 + i * 2.8).toFixed(1)}" cy="25.5" rx="1.8" ry="1.1" fill="none" stroke="var(--mark-stop)" stroke-width="1.4"/>`).join('')
        + ball(15.5, 18.5, 15) + `<path fill="var(--mark-stop)" d="M1 28h30v2.6h-30Z"/>`,
    // fumble kept: same ball + "!" family as fumble lost, neutral tone via CSS
    'fumble-kept': ball(2, 8, 22) + g('m:priority_high', 20, 1, 14),
    // flags
    penalty:    g('b:flag-fill', 2, 2, 28),
    'penalty-declined': g('b:flag-fill', 0, 1, 24) + g('m:block', 17, 15, 15),
    'penalty-offset':   g('b:flag-fill', 0, 0, 22) + g('m:sync_alt', 15, 14, 17),
    explosive:  g('m:bolt', 2, 2, 28),
};

const defs = Object.entries(SYMBOLS).map(([id, body]) => `    <symbol id="pi-${id}" viewBox="0 0 32 32">${body}</symbol>`).join('\n');
const astro = `---
// GENERATED by scripts/play-marks/compose.mjs -- edit the composition there, not this file.
// One copy per page (GamePage emits it; every PlaysTable shares it). Glyph sources and licenses:
// scripts/play-marks/glyphs.json (Material Symbols Apache-2.0; Bootstrap Icons MIT; Phosphor MIT --
// nothing needs attribution). Marks are solid silhouettes painted with --c.
---
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
${defs}
  </defs>
</svg>
`;
if (process.argv.includes('--print')) process.stdout.write(`<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>\n${defs}\n</defs></svg>`);
else { writeFileSync(join(here, '../../src/components/game/plays/PlayMarkSprite.astro'), astro); console.log('wrote PlayMarkSprite.astro with', Object.keys(SYMBOLS).length, 'symbols'); }
