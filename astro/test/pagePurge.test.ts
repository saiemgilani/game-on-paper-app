import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PURGE_SETTLE_MS, SUMMARY_PAGE_TAGS, latestIngest, shouldPurge } from '../src/utils/pagePurge';

describe('latestIngest', () => {
    const meta = {
        'cfb.team_summaries': '2026-11-01T15:08:07.036607+00:00',
        'nfl.team_summaries': '2026-10-31T20:56:59.700824+00:00',
        'pff_cfb.meta_team_summary': '2026-11-01T15:23:00+00:00', // not a site league
        'cfb.broken': 'not a time',
    };
    it('takes the newest stamp among the given schemas only', () => {
        expect(latestIngest(meta, ['cfb', 'nfl'])).toBe('2026-11-01T15:08:07.036607+00:00');
        expect(latestIngest(meta, ['nfl'])).toBe('2026-10-31T20:56:59.700824+00:00');
    });
    it('is undefined without meta', () => {
        expect(latestIngest(null, ['cfb'])).toBeUndefined();
        expect(latestIngest({}, ['cfb'])).toBeUndefined();
    });
});

describe('shouldPurge', () => {
    const latest = '2026-11-01T15:08:07Z';
    const at = Date.parse(latest);
    it('waits for the ingest to settle, then purges once', () => {
        expect(shouldPurge(latest, null, at + PURGE_SETTLE_MS - 1)).toBe(false);
        expect(shouldPurge(latest, null, at + PURGE_SETTLE_MS)).toBe(true);
        expect(shouldPurge(latest, '2026-10-31T15:00:00Z', at + PURGE_SETTLE_MS)).toBe(true);
        expect(shouldPurge(latest, latest, at + PURGE_SETTLE_MS)).toBe(false);
    });
    it('never purges without a stamp', () => {
        expect(shouldPurge(undefined, null, Date.now())).toBe(false);
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
    it('is accepted by the admin purge endpoint', () => {
        const src = readFileSync(new URL('../src/pages/admin/api/purge-game.ts', import.meta.url), 'utf8');
        for (const t of SUMMARY_PAGE_TAGS) expect(src).toContain(`'${t}'`);
    });
});
