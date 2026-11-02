import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PURGE_SETTLE_MS, SUMMARY_PAGE_TAGS, purgeTarget } from '../src/utils/pagePurge';

describe('purgeTarget', () => {
    const cfb = '2026-11-01T15:08:07.036607+00:00';
    const nfl = '2026-10-31T20:56:59.700824+00:00';
    const meta = {
        'cfb.team_summaries': cfb,
        'nfl.team_summaries': nfl,
        'pff_cfb.meta_team_summary': '2026-11-01T15:23:00+00:00', // not a site league
        'cfb.broken': 'not a time',
    };
    const settled = Date.parse(cfb) + PURGE_SETTLE_MS;
    const schemas = ['cfb', 'nfl'];

    it('waits for the ingest to settle, then purges once', () => {
        expect(purgeTarget(meta, schemas, {}, settled - 1)).toEqual({ 'nfl.team_summaries': nfl });
        const first = purgeTarget(meta, schemas, {}, settled);
        expect(first).toEqual({ 'cfb.team_summaries': cfb, 'nfl.team_summaries': nfl });
        expect(purgeTarget(meta, schemas, first!, settled + 60_000)).toBeUndefined();
    });
    it('purges for a re-ingested table older than another table', () => {
        const purgedFor = { 'cfb.team_summaries': cfb, 'nfl.team_summaries': '2026-10-30T00:00:00Z' };
        expect(purgeTarget(meta, schemas, purgedFor, settled)).toEqual({ 'cfb.team_summaries': cfb, 'nfl.team_summaries': nfl });
    });
    it('does not let a settling ingest block or trigger a purge', () => {
        const busy = { ...meta, 'cfb.player_summaries': new Date(settled - 60_000).toISOString() };
        const purgedFor = { 'cfb.team_summaries': '2026-10-30T00:00:00Z', 'nfl.team_summaries': nfl, 'cfb.player_summaries': 'old' };
        // the settled cfb change purges now; player_summaries keeps its old stamp until it settles
        expect(purgeTarget(busy, schemas, purgedFor, settled)).toEqual({ ...purgedFor, 'cfb.team_summaries': cfb });
        expect(purgeTarget(busy, schemas, { ...purgedFor, 'cfb.team_summaries': cfb }, settled)).toBeUndefined();
    });
    it('tells apart stamps within one millisecond', () => {
        const purgedFor = { 'cfb.team_summaries': '2026-11-01T15:08:07.036000+00:00', 'nfl.team_summaries': nfl };
        expect(purgeTarget(meta, schemas, purgedFor, settled)).toEqual({ 'cfb.team_summaries': cfb, 'nfl.team_summaries': nfl });
    });
    it('never purges without meta', () => {
        expect(purgeTarget(null, schemas, {}, settled)).toBeUndefined();
        expect(purgeTarget({}, schemas, {}, settled)).toBeUndefined();
    });
});

describe('the scheduled purge', () => {
    it('is registered before the scoreboard refresh is awaited', () => {
        const src = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
        expect(src.indexOf('ctx.waitUntil(purgePagesAfterIngest(env))')).toBeGreaterThan(-1);
        expect(src.indexOf('ctx.waitUntil(purgePagesAfterIngest(env))')).toBeLessThan(src.indexOf('await getCurrentScoreboard'));
    });
});

describe('SUMMARY_PAGE_TAGS', () => {
    it('covers every tag on the 3-day route rules', () => {
        const config = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
        const ruleTags = [...config.matchAll(/maxAge: 60 \* 60 \* 24 \* 3, tags: \[([^\]]*)\]/g)]
            .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((t) => t[1]))
            .filter((t) => t !== 'favorites-enabled'); // the shared game/scoreboard tag, not a summaries one
        expect(ruleTags.length).toBeGreaterThan(0);
        for (const t of ruleTags) expect(SUMMARY_PAGE_TAGS).toContain(t);
    });
    it("covers the chart builder's own tag", () => {
        const src = readFileSync(new URL('../src/routes/charts.ts', import.meta.url), 'utf8');
        expect(src).toContain("tags: ['chart'");
        expect(SUMMARY_PAGE_TAGS).toContain('chart');
    });
    it('is accepted by the admin purge endpoint', () => {
        const src = readFileSync(new URL('../src/pages/admin/api/purge-game.ts', import.meta.url), 'utf8');
        for (const t of SUMMARY_PAGE_TAGS) expect(src).toContain(`'${t}'`);
    });
});
