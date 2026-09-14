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

When a change is league-specific, shoot the `/nfl` route **and** its `cfb` twin —
the two share components, so a regression usually hits both. `img/visual/` is
git-ignored; don't commit the PNGs.

## PR evidence — REQUIRED on every PR
Every PR that touches `astro/` or `python/` carries two pieces of evidence in its
description (or a comment on it), filled in via `.github/pull_request_template.md`.
A backend change counts: the processor's output is what the game page renders.
Only PRs confined to docs, CI, or repo config are exempt, and they say so in
the template.

1. **The four preview screenshots.** Take them from the visual-check matrix
   above: desktop-light, desktop-dark, mobile-light, mobile-dark, of the page the
   change affects most. Build them from the **PR branch**, not production. Lay
   them out as a 2×2 table of above-the-fold thumbnails, each linking to the
   full-page image. Full-page mobile shots run 10k+ px tall, too long to inline.
2. **A Lighthouse comparison of the PR against its base.** Run it on the same
   page(s) as the screenshots, and include a final game with full play-by-play
   when game pages are affected.
   - **Builds:** production builds (`astro build`) of both trees, never
     `astro dev`. Preview-gated features must be on in **both** trees, otherwise
     one side measures the classic page.
   - **Runs:** Lighthouse CLI, `mobile` and `--preset=desktop`, at least 3 runs
     each. Report the **median and the min–max run range**. Performance varies
     by 10+ points between identical builds, so a median gap whose ranges
     overlap is noise, and the report says so.
   - **Metrics:** the four category scores, FCP, LCP, TBT, CLS, Speed Index,
     gzipped HTML, JS transfer, DOM elements, plus the accessibility audits that
     newly fail.
   - **Server time:** uncached local page generation (15–20 s on a game page)
     swamps frontend differences. When it does, also measure frontend-only:
     serve each tree's server-rendered HTML with that tree's own `dist/` assets
     from a static gzip server.
   - **Compression:** local `astro preview` does not compress. Take HTML size
     from a gzip server, not from the preview.
   - **Findings:** call out every regression with its likely cause, e.g. the
     layout-shift element Lighthouse's `layout-shifts` audit names.

**Hosting images:** the GitHub API cannot upload images. Push them to the orphan
branch `pr-previews` (`pr<N>/{desktop,mobile}-{light,dark}.jpg`,
`pr<N>/lighthouse.png`) and embed them via
`https://raw.githubusercontent.com/saiemgilani/game-on-paper-app/<commit-sha>/pr<N>/…`.
Pin the **commit SHA**, not the branch name, so later pushes can't change
what an old comment shows. Workflows ignore that branch.

## Guardrails
- Branch + PR, never push `main`. Stage explicit paths. One logical change per PR.
- After merging a GOP PR, the deploy runs on push to `main`; smoke the deployed
  URL (status, and grep the HTML) before calling it shipped.
