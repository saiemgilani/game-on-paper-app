import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import { GLOBAL_GROUP_LIST, SEASON_GROUP_MAP, groupsForSeason } from '../src/resources/schedule';
import { AVAILABLE_SEASONS } from '../src/utils/constants';

// static/season_groups.json is generated (scripts/update_groups.py); these pin
// the realignments it exists to get right and the shape the dropdown relies on.

const label = (season: number, id: number) => groupsForSeason(season).find((g) => g.id === id)?.name;
const ids = (season: number) => groupsForSeason(season).map((g) => g.id);

describe('groupsForSeason', () => {
    test('ESPN 179 carries each season\'s OVC-lineage name; 26 is the OVC only up to 2022', () => {
        expect(label(2022, 26)).toBe('OVC');
        expect(label(2022, 179)).toBeUndefined();
        expect(label(2023, 179)).toBe('Big South-OVC');
        expect(label(2025, 179)).toBe('OVC-Big South');
        expect(label(2026, 179)).toBe('OVC');
        expect(label(2026, 26)).toBeUndefined();
    });

    test('conferences appear only in the seasons they played', () => {
        expect(label(2022, 176)).toBe('ASUN');
        expect(label(2022, 16)).toBe('WAC');
        expect(ids(2026)).not.toContain(176);
        expect(ids(2026)).not.toContain(16);
        expect(ids(2026)).not.toContain(40);
        expect(label(2023, 177)).toBe('UAC');
        expect(ids(2022)).not.toContain(177);
        expect(label(2026, 32)).toBe('FCS Independents');
        expect(label(2010, 9)).toBe('Pac-10');
        expect(label(2010, 10)).toBe('Big East');
    });

    test('every served season keeps the structural entries in GOP\'s positions', () => {
        for (const season of AVAILABLE_SEASONS) {
            const list = SEASON_GROUP_MAP[String(season)];
            expect(list, `season ${season}`).toBeDefined();
            expect(list.slice(0, 2).map((g) => g.id)).toEqual([80, -1]);
            expect(list.slice(-2).map((g) => g.id)).toEqual([90, 35]);
            expect(list.map((g) => g.id)).toContain(81);
            expect(new Set(list.map((g) => g.id)).size).toBe(list.length);
        }
    });

    test('the current season keeps the static list\'s order and labels for the ids they share', () => {
        const current = groupsForSeason(AVAILABLE_SEASONS[AVAILABLE_SEASONS.length - 1]);
        const shared = new Set(current.map((g) => g.id));
        const fromStatic = GLOBAL_GROUP_LIST.filter((g) => shared.has(g.id));
        const fromSeason = current.filter((g) => GLOBAL_GROUP_LIST.some((s) => s.id === g.id));
        expect(fromSeason).toEqual(fromStatic);
    });

    test('a season the file lacks falls back to the static list', () => {
        expect(groupsForSeason(1999)).toBe(GLOBAL_GROUP_LIST);
    });
});

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function render(locals: Record<string, unknown>, group = 177) {
    const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
    return container.renderToString(SchedulePage, {
        props: { season: 2024, seasontype: 2, week: 5, group, isScoreboard: false, games: [] },
        request: new Request(`https://gameonpaper.com/year/2024/type/2/week/5?group=${group}`),
        locals: locals as any,
    });
}

describe('the conference filter follows the season', () => {
    test('a public viewer gets the viewed season\'s conferences', async () => {
        const html = await render({});
        expect(html).toMatch(/<option value="177"[^>]*selected[^>]*>UAC<\/option>/);
        expect(html).toContain('>Big South-OVC</option>');
        expect(html).not.toContain('>ASUN</option>');
    });

    test('a ?group= the season lacks falls back to the default instead of submitting it unseen', async () => {
        // 26 is the OVC only up to 2022; kept, the select would show FBS and submit 26
        const html = await render({}, 26);
        expect(html).toMatch(/<option value="80"[^>]*selected[^>]*>FBS \(I-A\)<\/option>/);
    });
});
