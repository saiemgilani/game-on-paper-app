## Summary
<!-- What changed and why. Link the issue if there is one. -->

## Tests
<!-- `cd astro && npx vitest run` / `cd python && pytest` results, plus anything exercised by hand. -->

## Evidence
<!-- The pr-evidence workflow posts the four screenshots (desktop/mobile × light/dark) and a
     Lighthouse comparison against the base as a comment on this PR, updated on every push.
     Pick the pages it measures (up to 4) with the line below; otherwise it uses a final game page.
     Fork PR or docs/CI-only change? See CLAUDE.md "PR evidence". -->

Evidence routes: /game/401856682

## Checklist
- [ ] vitest + pytest pass locally
- [ ] `Evidence routes:` names the pages this change affects most
- [ ] The pr-evidence comment is green, or every regression it flags is explained here
- [ ] Preview-gated work stays behind its flag in `astro/src/utils/features.ts`
