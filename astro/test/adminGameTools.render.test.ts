import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// The admin tools must be INVISIBLE without an admin session. GameHeader is
// the one file both game-page twins import, so rendering it is the check that
// the toolbar exists on whichever twin renders -- and, with no session, that
// the header is byte-for-byte the header the public gets.

vi.mock('astro:env/server', () => ({ getSecret: () => undefined }));
// No admin render may reach the API: a toolbar that probed every source would
// be one upstream fetch per source per page view.
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => { throw new Error(`unexpected fetch in test: ${url}`); },
}));

const GAME = {
    header: {
        id: '401856682',
        competitions: [{
            date: '2025-11-02T17:00Z',
            status: { type: { name: 'STATUS_FINAL', completed: true, state: 'post', detail: 'Final', description: 'Final' } },
            competitors: [
                { score: '24', team: { id: '7', abbreviation: 'HOME', location: 'Home', displayName: 'Home Team' } },
                { score: '17', team: { id: '13', abbreviation: 'AWAY', location: 'Away', displayName: 'Away Team' } },
            ],
            broadcasts: [],
        }],
    },
    teamInfo: { home: { id: '7', abbreviation: 'HOME' }, away: { id: '13', abbreviation: 'AWAY' } },
    plays: [], advBoxScore: {},
} as any;

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function renderHeader(locals: Record<string, unknown>, search = '') {
    const { default: GameHeader } = await import('../src/components/game/GameHeader.astro');
    return container.renderToString(GameHeader, {
        props: { game: GAME },
        request: new Request(`https://gameonpaper.com/game/401856682${search}`),
        locals: locals as any,
    });
}

describe('the admin tools on the game header', () => {
    test('a viewer without an admin session sees nothing, whatever the URL says', async () => {
        const html = await renderHeader({ preview: true }, '?view=live&flags=game-page-v2:off&source=shield');
        expect(html).not.toContain('data-admin-game-tools');
        expect(html).not.toContain('source-compare');
        // and the header is what it renders today
        expect(html).toBe(await renderHeader({ preview: true }));
    });

    test('an admin gets the view dropdown and the flag dropdown', async () => {
        const html = await renderHeader({ adminAuthed: true });
        expect(html).toContain('data-admin-game-tools');
        // a select, not a pill group: FilterGroup goes away in #270
        expect(html).toContain('form-select form-select-sm w-auto');
        expect(html).not.toContain('btn btn-sm btn-outline-secondary');
        expect(html).toContain('View: Live');
        expect(html).toContain('View: Preview');
        expect(html).toContain('view=preview');
        // the header above already carries the bottom margin; the toolbar only
        // needs a top one where it wraps onto its own line
        expect(html).toContain('mt-3 mt-md-0');
        expect(html).not.toContain('gap-2 mb-3');
        // source-switch is off for this render (no preview state), so no source select
        expect(html).not.toContain('source=');
    });

    test('with the source-switch flag on, the source pills and provenance render', async () => {
        const game = { ...GAME, provenance: { source: 'espn', requested: 'shield', fallback_used: true, contract_version: '0.1.0', contract_sha: 'abcdef1234' } };
        const { default: GameHeader } = await import('../src/components/game/GameHeader.astro');
        const html = await container.renderToString(GameHeader, {
            props: { game },
            request: new Request('https://gameonpaper.com/game/401856682?source=shield'),
            locals: { adminAuthed: true, preview: true } as any,
        });
        expect(html).toContain('Choose the processing source');
        expect(html).toContain('Served: espn');
        expect(html).toContain('(fallback)');
        expect(html).toContain('contract abcdef1');
        // the comparison is a muted paragraph under the tools, not a titled panel
        expect(html).toContain('data-admin-source-compare');
        expect(html).toContain('class="text-muted text-small mt-2 mb-1"');
        expect(html).not.toContain('Source Comparison');
        expect(html).not.toContain('[show/hide]');
        expect(html).not.toContain('class="card');
        expect(html).toContain('numeral');
    });
});
