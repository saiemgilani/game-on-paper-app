# Copilot instructions — game-on-paper-app

Astro SSR on Cloudflare Workers with Svelte islands in `astro/`; a Flask
play-by-play processor in `python/`. `CLAUDE.md` at the repo root is the full
set of working rules. This file carries the ones that apply to PR authoring and review.

## Every PR needs visual and performance evidence
A PR that touches `astro/` or `python/` is not ready for review until its
description (or a comment) contains both of the following. Backend changes
count, because the processor's output is what the game page renders. Only PRs
confined to docs, CI, or repo config are exempt, and they must state why.

1. **Four preview screenshots of the PR branch:** desktop 1280×800 and mobile
   390×844, each in light and dark. Dark mode must be emulated through
   `prefers-color-scheme`, not faked. Use `cd astro && npm run visual-check -- <route>`.
   A league-specific change covers both the `/nfl` route and its `cfb` twin.
2. **A Lighthouse comparison of the PR against its base branch** on the same page(s):
   - production builds of both trees (never `astro dev`), with preview-gated features on in both;
   - mobile and desktop presets, at least 3 runs each, reported as median plus min–max run range;
   - the four category scores, FCP, LCP, TBT, CLS, Speed Index, gzipped HTML, JS transfer, DOM elements;
   - accessibility audits that newly fail;
   - frontend-only numbers when local page generation time dominates.

Images go on the orphan `pr-previews` branch and are embedded via
`raw.githubusercontent.com` URLs pinned to a commit SHA.

## When reviewing a PR
- If the screenshots or the Lighthouse comparison are missing and the PR is not
  exempt, say so as the first comment.
- If only some of the four screenshots are present, name the missing ones.
- Treat a Lighthouse regression as real only when the run ranges do not overlap.
  Ask for a likely cause (the element named by the `layout-shifts` audit, island
  prop size, new blocking script) rather than accepting a bare score drop.
- If a Performance drop comes with gzipped HTML growth but fewer DOM elements,
  point to serialized Svelte island props as the usual cause.

## Other rules
- Branch + PR; never push `main`. One logical change per PR.
- Preview-gated work stays behind its flag in `astro/src/utils/features.ts`.
- Run `cd astro && npx vitest run` and `cd python && pytest` before opening a PR.
