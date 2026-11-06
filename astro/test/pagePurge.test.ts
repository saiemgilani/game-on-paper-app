import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PURGED_FOR_INGEST_KEY, PURGE_SETTLE_MS, SUMMARY_PAGE_TAGS, purgeTarget } from '../src/utils/pagePurge';

// The cron itself (worker.ts), with every read it makes mocked: no Data API, ESPN or Cloudflare call.
const { purge, sdvPurgeTarget, getCurrentScoreboard } = vi.hoisted(() => ({
    purge: vi.fn(), sdvPurgeTarget: vi.fn(), getCurrentScoreboard: vi.fn(),
}));
vi.mock('cloudflare:workers', () => ({ cache: { purge }, env: {} }));
vi.mock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
vi.mock('../src/resources/sdv', () => ({ sdvPurgeTarget }));
vi.mock('../src/resources/espn', () => ({ getCurrentScoreboard }));
import worker from '../src/worker';

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
    const target = { 'cfb.team_summaries': '2026-11-01T15:08:07.036607+00:00' };
    let kv: { get: ReturnType<typeof vi.fn>, put: ReturnType<typeof vi.fn> };
    // runs the cron at midnight UTC (a 15-minute mark and a scoreboard refresh under either
    // season config); resolves once the purge it registered has finished
    async function runCron() {
        const waits: Promise<unknown>[] = [];
        await worker.scheduled!({ scheduledTime: Date.UTC(2026, 10, 1) } as ScheduledController,
            { SDV_API_CACHE: kv } as unknown as Env, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext);
        await Promise.all(waits);
    }
    beforeEach(() => {
        vi.clearAllMocks();
        kv = { get: vi.fn(async () => ({})), put: vi.fn(async () => {}) };
        sdvPurgeTarget.mockResolvedValue(target);
        getCurrentScoreboard.mockResolvedValue(undefined);
    });

    it('records the stamps only after the purge succeeds', async () => {
        purge.mockResolvedValue({ success: true, errors: [] });
        await runCron();
        expect(purge).toHaveBeenCalledWith({ tags: SUMMARY_PAGE_TAGS });
        expect(kv.put).toHaveBeenCalledWith(PURGED_FOR_INGEST_KEY, JSON.stringify(target));
    });
    it('leaves the stamps for a retry when the purge fails', async () => {
        purge.mockResolvedValue({ success: false, errors: [{ code: 1, message: 'nope' }] });
        await runCron();
        expect(purge).toHaveBeenCalledTimes(1);
        expect(kv.put).not.toHaveBeenCalled();
        purge.mockRejectedValue(new Error('down'));
        await runCron();
        expect(kv.put).not.toHaveBeenCalled();
    });
    it('does not purge when nothing new has settled', async () => {
        sdvPurgeTarget.mockResolvedValue(undefined);
        await runCron();
        expect(purge).not.toHaveBeenCalled();
        expect(kv.put).not.toHaveBeenCalled();
    });
    it('runs even while the scoreboard refresh hangs', async () => {
        getCurrentScoreboard.mockReturnValue(new Promise(() => {}));
        purge.mockResolvedValue({ success: true, errors: [] });
        const waits: Promise<unknown>[] = [];
        void worker.scheduled!({ scheduledTime: Date.UTC(2026, 10, 1) } as ScheduledController,
            { SDV_API_CACHE: kv } as unknown as Env, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext);
        await Promise.all(waits);
        expect(getCurrentScoreboard).toHaveBeenCalled();
        expect(waits).toHaveLength(1);
        expect(kv.put).toHaveBeenCalled();
    });
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
