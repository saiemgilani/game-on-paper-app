import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// The feedback button ('feedback-inbox') is admin-only: the Footer every page shell renders must
// be byte-for-byte the public footer for anyone without an admin session, so the copy Workers
// Caching keeps never carries the button, and the webhook secret never reaches any page.

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFG';
const secrets: Record<string, string | undefined> = { APP_VERSION: 'test', DISCORD_INBOX_WEBHOOK_URL: HOOK };
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => secrets[k] }));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

async function footer(locals: Record<string, unknown>) {
    const { default: Footer } = await import('../src/components/Footer.astro');
    return container.renderToString(Footer, { request: new Request('https://gameonpaper.com/game/401856682'), locals: locals as any });
}

describe('the feedback button in the footer', () => {
    test('an anonymous visitor gets no button, no sheet, no script', async () => {
        const html = await footer({});
        expect(html).not.toContain('feedback');
        expect(html).not.toContain('webhooks');
    });

    test('a preview viewer who is not an admin gets none either', async () => {
        const html = await footer({ preview: true });
        expect(html).not.toContain('feedback');
        // and the footer is the one a preview viewer gets today
        expect(html).toBe(await footer({ preview: true, adminAuthed: false }));
    });

    test('an admin with the flag off gets none', async () => {
        expect(await footer({ adminAuthed: true })).not.toContain('feedback');
        expect(await footer({ adminAuthed: true, preview: true, flagOverrides: { 'feedback-inbox': false } })).not.toContain('feedback');
    });

    test('an admin with the flag on gets the button and the sheet, never the secret', async () => {
        const html = await footer({ adminAuthed: true, preview: true });
        expect(html).toContain('data-feedback-inbox');
        expect(html).toContain('<dialog id="feedback-sheet"');
        expect(html).toContain('accept="image/*"');
        for (const label of ['Bug', 'Idea', 'Link', 'Data', 'Question', 'Jack', 'Akshay', 'Saiem']) expect(html).toContain(`>${label}</option>`);
        expect(html).toContain('/admin/api/feedback');
        // site copy rule: a colon, not a dash
        expect(html).toContain(`"Sent: you'll get a reply in #gop-inbox"`);
        expect(html).not.toContain('webhooks');
        expect(html).not.toContain('data-feedback-unconfigured');
    });

    test('unconfigured: the sheet says so and Send is disabled', async () => {
        secrets.DISCORD_INBOX_WEBHOOK_URL = undefined;
        try {
            const html = await footer({ adminAuthed: true, preview: true });
            expect(html).toContain('data-feedback-unconfigured');
            expect(html).toMatch(/data-feedback-submit[^>]*disabled/);
        } finally {
            secrets.DISCORD_INBOX_WEBHOOK_URL = HOOK;
        }
    });
});
