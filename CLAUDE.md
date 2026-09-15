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

## PR evidence — REQUIRED on every PR, posted automatically
Every PR that touches `astro/` or `python/` carries two pieces of evidence. A
backend change counts: the processor's output is what the game page renders.
PRs confined to docs, CI, or repo config are exempt.

1. **The four preview screenshots** of the PR: desktop-light, desktop-dark,
   mobile-light, mobile-dark (the matrix above), as above-the-fold thumbnails
   linking to full pages.
2. **A Lighthouse comparison of the PR against its base**, on the same page(s).

**`.github/workflows/pr-evidence.yml` produces both on every push** to a
same-repo PR and keeps them in one PR comment. It compares GitHub's PR merge
commit against the base tip it merged onto, so only this PR's changes differ even
after `main` moves. Choose pages with an `Evidence routes: /a /b` line in the PR
description; the default is a final game with full play-by-play (`/game/401856682`),
the heaviest page. Fork PRs get no secrets, so their evidence is produced locally
and pasted into the template. When the workflow fails, fix the cause or explain
in the PR; never paste numbers the workflow didn't measure.

Run the same thing locally with `astro/scripts/lighthouse-compare.mjs`. Its
header documents the flags, including `LH_ASTRO_PREFIX` for hosts whose glibc
is too old for workerd:

```bash
cd astro
node scripts/lighthouse-compare.mjs --base origin/main --head HEAD --shots \
  --python-url http://127.0.0.1:5177 \
  --backend-cmd 'uv run gunicorn app:app -c gunicorn.conf.py -b 127.0.0.1:5177' /game/401856682
node scripts/pr-evidence-comment.mjs --out img/lighthouse/<base>-<head>   # the comment, as markdown
```

Why the method is what it is (the script enforces all of it):
- **Builds:** production `astro build` of both trees, never `astro dev`, with every
  `preview` flag forced on in **both**. Otherwise one side measures the classic page.
  A `preview` flag normally renders only for a viewer holding the signed preview
  cookie. Nothing a headless Lighthouse run can present, so the script instead
  rewrites `'preview'` → `'on'` in `src/utils/features.ts` inside its throwaway
  worktrees (never in your checkout). `--flags a,b` limits which flags it rewrites.
- **Frontend-only by default:** uncached local page generation (15–20 s on a game
  page) swamps frontend differences, so each tree's rendered HTML is served with its
  own `dist/client` from a gzip server. `astro preview` doesn't compress, so
  this is also the only place HTML/JS sizes match production. `--mode both` adds
  end-to-end runs.
- **Run ranges and floors:** Performance varies by 10+ points between identical
  builds, and a game page's CLS swings 0.56–1.13 with hydration timing. Every metric
  keeps its min–max range. A delta is flagged only when the gap between the base and
  PR ranges clears an absolute floor **and** the median moved by a relative floor
  (`astro/scripts/lighthouse-verdicts.mjs`). Performance is the exception: it is
  already a 0–100 score, so it needs only the range gap (3 points), with no relative floor. Merely non-overlapping ranges produced
  false flags on identical HTML (TBT in #247, CLS by 0.006 in #250). When base and PR
  serve identical HTML (ignoring Astro's random island `uid`s) and identical built
  client files for a page, frontend results say so instead of listing deltas. A live
  game gets a warning, since base and PR capture different plays. Base and PR runs
  alternate.
- **Findings:** non-overlapping regressions are listed with a likely cause (the
  largest layout-shift element for CLS), along with audits that newly fail.

**Hosting images:** the GitHub API cannot upload images, so screenshots go on the
orphan branch `pr-previews` (`pr<N>/<head-sha7>/…`) and are embedded via
`raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/…`, pinned to the commit
so later pushes can't change an old comment. No workflow triggers on that branch.

## Guardrails
- Branch + PR, never push `main`. Stage explicit paths. One logical change per PR.
- After merging a GOP PR, the deploy runs on push to `main`; smoke the deployed
  URL (status, and grep the HTML) before calling it shipped.
