Steps modules for `npm run walkthrough -- --steps scripts/walkthroughs/<name>.mjs`.
Each exports `default async (page, base) => { ... }` using the plain Playwright page API.
Keep one flow per file, under ~60 s of recording; the clip is named `flow-<file>`.
A flow on a `preview`-flagged page needs the signed preview cookie: `WALKTHROUGH_COOKIE="gop_preview=..."` ("name=value; name2=value2", scoped to BASE).
