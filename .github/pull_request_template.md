## Summary
<!-- What changed and why. Link the issue if there is one. -->

## Tests
<!-- `cd astro && npx vitest run` / `cd python && pytest` results, plus anything exercised by hand. -->

## Evidence
<!-- The pr-evidence workflow posts the four screenshots (desktop/mobile × light/dark), a walkthrough
     clip per route, and a Lighthouse comparison against the base as a comment on this PR, updated on
     every push. Pick the pages (up to 4) with the first line; otherwise it uses a final game page. Name
     committed scripts/walkthroughs/*.mjs flows (up to 4) with the second line when the PR adds or
     alters an interaction. Fork PR or docs/CI-only change? See CLAUDE.md "PR evidence". -->

Evidence routes: /game/401856682
Walkthrough steps:

## Walkthrough
<!-- Only for a clip the workflow cannot record (fork PR): drag the mp4/webm from a local
     `npm run walkthrough` here. Otherwise write "see evidence comment". -->

## Checklist
- [ ] vitest + pytest pass locally
- [ ] `Evidence routes:` names the pages this change affects most
- [ ] The pr-evidence comment is green, or every regression it flags is explained here
- [ ] The evidence comment links a walkthrough clip for every affected route/flow (`Walkthrough steps:` names any new interaction), or one is attached above
- [ ] Preview-gated work stays behind its flag in `astro/src/utils/features.ts`
