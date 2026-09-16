# Copilot instructions — game-on-paper-app

Astro SSR on Cloudflare Workers with Svelte islands in `astro/`; a Flask
play-by-play processor in `python/`. `CLAUDE.md` at the repo root is the full
set of working rules. This file carries the ones that apply to PR authoring and review.

## Every PR gets visual and performance evidence, automatically
`.github/workflows/pr-evidence.yml` runs on every same-repo PR that touches
`astro/` or `python/`. On every push it posts or updates one comment (marked
`<!-- pr-evidence -->`) containing:
1. the four preview screenshots of the PR: desktop 1280×800 and mobile 390×844,
   each in light and dark;
2. a Lighthouse comparison of the PR against its base: production builds of both,
   mobile + desktop, 3 runs each, median and min–max run range, with regressions
   flagged only when the run ranges don't overlap.

### When authoring a PR (including as the Copilot coding agent)
- Fill in `.github/pull_request_template.md`. Set `Evidence routes:` to the pages
  your change affects most (up to 4 paths). For a league-specific change, list
  the `/nfl` route and its `cfb` twin.
- Never write screenshots, scores or metrics into the PR by hand. The workflow's
  comment is the only source of evidence. If it did not run or failed, say so and
  link the run.
- Workflows on PRs opened by the Copilot coding agent wait for a maintainer to
  approve the run. Note in the PR description that the evidence comment appears
  after approval.
- To iterate before pushing, the environment from
  `.github/workflows/copilot-setup-steps.yml` has lighthouse and playwright-core
  installed: run `node astro/scripts/visual-check.mjs` and
  `node astro/scripts/lighthouse-compare.mjs` (see their headers). Pages that
  need ESPN or the SDV data API may fail inside the agent firewall; that is
  expected, and the workflow's run is the one that counts.
- If the evidence comment flags a regression, fix it or explain it in the PR
  description (for example, a deliberate trade-off).

### When reviewing a PR
- If the PR touches `astro/` or `python/` and has no `<!-- pr-evidence -->`
  comment, or the comment reports errors, say so first.
- Check that `Evidence routes:` covers the pages the diff actually changes. Ask for
  the right routes rather than accepting the default game page for an unrelated page.
- Treat a flagged regression (🔴) as real and ask for its cause or a fix. Don't
  raise score differences the comment classifies as within noise.
- If Performance drops alongside gzipped HTML growth with fewer DOM elements,
  point to serialized Svelte island props as the usual cause.

## Other rules
- Branch + PR; never push `main`. One logical change per PR.
- Preview-gated work stays behind its flag in `astro/src/utils/features.ts`.
- Run `cd astro && npx vitest run` and `cd python && pytest` before opening a PR.
