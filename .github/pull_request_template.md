## Summary
<!-- What changed and why. Link the issue if there is one. -->

## Tests
<!-- `cd astro && npx vitest run` / `cd python && pytest` results, plus anything exercised by hand. -->

## Preview screenshots
<!-- REQUIRED when the PR touches astro/ or python/ (see CLAUDE.md "PR evidence").
     Shoot the PR branch, not production: `cd astro && npm run visual-check -- <route>`.
     Thumbnails above the fold; link each to its full-page image. For a league-specific change, cover /nfl and its cfb twin.
     Exempt (docs / CI / repo config only)? Delete the tables and write the reason. -->

Route: `/…`

| | light | dark |
|---|---|---|
| **desktop 1280×800** | <!-- [<img src="…" width="440">](…) --> | <!-- … --> |
| **mobile 390×844** | <!-- [<img src="…" width="195">](…) --> | <!-- … --> |

## Lighthouse: this PR vs base
<!-- REQUIRED alongside the screenshots. Production builds of base and head, the same page(s), mobile + desktop presets, ≥3 runs each.
     Report median (min–max run range). When local page generation dominates, add frontend-only numbers (see CLAUDE.md).
     Flag every regression with its likely cause; say "noise" when the run ranges overlap. -->

Page: `/…` · base `<sha>` → head `<sha>` · runs per preset: `N`

| | base (mobile) | PR (mobile) | base (desktop) | PR (desktop) |
|---|---|---|---|---|
| Performance (range) | | | | |
| Accessibility | | | | |
| Best Practices | | | | |
| SEO | | | | |
| FCP / LCP | | | | |
| TBT | | | | |
| CLS | | | | |
| HTML gzip / JS transfer | | | | |
| DOM elements | | | | |

Newly failing audits: <!-- none / list -->

## Checklist
- [ ] vitest + pytest pass locally
- [ ] Four screenshots (desktop/mobile × light/dark) from this branch, or an exemption reason
- [ ] Lighthouse base-vs-PR comparison with run ranges, or an exemption reason
- [ ] Preview-gated work stays behind its flag in `astro/src/utils/features.ts`
