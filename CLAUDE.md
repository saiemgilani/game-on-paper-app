# game-on-paper-app — working notes

Astro 5 SSR on Cloudflare Workers (Svelte 5 islands) in `astro/`; a Flask
processor (`sportsdataverse` play-by-play) in `python/`. The site renders two
leagues: `cfb` (unprefixed, the default) and `nfl` (explicit pages under
`astro/src/pages/nfl/**`; see `astro/src/utils/league.ts`).

## Local gates
- Node here is often < 22.12, so `astro check` / `astro build` / `astro dev`
  can't run locally — **CI covers the templates**. What runs locally:
  `cd astro && npx vitest run` and `cd python && pytest`. Run both before a PR.
- Never claim a rendered change works from the code alone. Exercise it: vitest
  for logic, and a **visual check** (below) for anything a person sees.

## Visual verification — REQUIRED for any UI change
Any change that touches a rendered page, an Astro/Svelte component, or CSS —
including "just a copy/colour tweak" — is not done until it has been seen in
**all four combinations**, because each is a different code path or layout:

|          | light | dark |
|----------|-------|------|
| desktop (1280×800) | ✓ | ✓ |
| mobile (390×844)   | ✓ | ✓ |

Dark mode is driven by `prefers-color-scheme` (see `public/assets/css/dark-*.css`),
so it must be **emulated**, not faked by resizing a window or toggling a class —
a real dark-mode viewer hits the media query. Mobile is a real narrow viewport,
not a scaled-down desktop. So: two viewports × two schemes, every time.

Capture the matrix with the committed helper (it emulates both axes and shoots
full-page at 2× density):

```bash
cd astro
# against the deployed site (or a local `npm run preview` on :4321):
BASE=https://gameonpaper.com npm run visual-check -- /nfl /nfl/year/2025/teams/tendencies
# writes astro/img/visual/<route>-<device>-<scheme>.png (4 per route)
```

`scripts/visual-check.mjs` uses `playwright-core` (install it once with
`npm i -g playwright-core` or `npm i -D playwright-core`; it downloads **no**
browser) driving your installed Google Chrome, or the chromium at
`$VISUAL_CHECK_EXECUTABLE`. It is deliberately not a repo dependency, so
`npm ci` stays lean, and it exits non-zero if a route fails to load so an error
page never passes as a valid shot. (Isolated root container that needs the
Chrome sandbox off: set `VISUAL_CHECK_NO_SANDBOX=1`.)

Attach the four (or the relevant subset) to the PR, or send them to reviewers.
When a change is league-specific, shoot the `/nfl` route **and** its `cfb` twin —
the two share components, so a regression usually hits both. `img/visual/` is
git-ignored; don't commit the PNGs.

## Guardrails
- Branch + PR, never push `main`. Stage explicit paths. One logical change per PR.
- After merging a GOP PR, the deploy runs on push to `main`; smoke the deployed
  URL (status, and grep the HTML) before calling it shipped.
