import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// POST /admin/api/feedback ('feedback-inbox'): an admin's report becomes a new post in the
// #gop-inbox Discord forum. The contract: admin session and flag required, the webhook URL comes
// only from the secret (and is the only URL fetched), sizes/types/rate are bounded, and the
// multipart payload is exactly what a forum post needs, with mentions disabled.

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFG';
const secrets: Record<string, string | undefined> = {};
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => secrets[k] }));

const kv = new Map<string, string>();
vi.mock('cloudflare:workers', () => ({
    env: { ESPN_API_CACHE: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } } },
}));

import { POST } from '../src/pages/admin/api/feedback';
import { discordPayload, FEEDBACK_TAGS, pageRoute, sniffImage, webhookUrl } from '../src/utils/feedback';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ADMIN = { adminAuthed: true, preview: true, adminActor: 'admin-cookie' };

function form(over: Record<string, string | Blob | null> = {}): FormData {
    const fields: Record<string, string | Blob | null> = {
        type: 'bug', from: 'Saiem', title: 'Play table overlaps on iPhone', message: 'The play table runs off the right edge.',
        page: 'https://gameonpaper.com/nfl/game/401772510?view=preview', viewport: '390x844', ...over,
    };
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        if (v === null) continue;
        if (v instanceof Blob) fd.append(k, v, 'shot.png'); else fd.append(k, v);
    }
    return fd;
}

async function post(locals: Record<string, unknown>, body: BodyInit = form(), headers: Record<string, string> = {}) {
    const request = new Request('https://gameonpaper.com/admin/api/feedback', {
        method: 'POST', body, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari', ...headers },
    });
    const res = await (POST as any)({ locals, request });
    return { res, json: await res.json() };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    kv.clear();
    secrets.DISCORD_INBOX_WEBHOOK_URL = HOOK;
    fetchMock = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('who may post', () => {
    test('no admin session: 401, nothing sent', async () => {
        const { res } = await post({ preview: true });
        expect(res.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('an admin with the flag off (no preview): 404, nothing sent', async () => {
        const { res } = await post({ adminAuthed: true });
        expect(res.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('an admin flag override turns it on without a preview cookie', async () => {
        const { res } = await post({ adminAuthed: true, flagOverrides: { 'feedback-inbox': true } });
        expect(res.status).toBe(200);
    });

    test('the secret unset: 503 explaining it, nothing sent', async () => {
        secrets.DISCORD_INBOX_WEBHOOK_URL = undefined;
        const { res, json } = await post(ADMIN);
        expect(res.status).toBe(503);
        expect(json.error).toContain('DISCORD_INBOX_WEBHOOK_URL');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('a secret that is not a Discord webhook counts as unset: no other host is ever fetched', async () => {
        secrets.DISCORD_INBOX_WEBHOOK_URL = 'https://evil.example/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz';
        expect((await post(ADMIN)).res.status).toBe(503);
        secrets.DISCORD_INBOX_WEBHOOK_URL = 'http://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz';
        expect((await post(ADMIN)).res.status).toBe(503);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('the post sent to Discord', () => {
    test('a forum post: thread_name, the type tag, mentions off, the context block, ?wait=true on the secret URL', async () => {
        const { res, json } = await post(ADMIN, form({ type: 'data', message: 'hey @everyone <@&42> look' }));
        expect(res.status).toBe(200);
        expect(json).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${HOOK}?wait=true`);
        expect(init.method).toBe('POST');
        const body = init.body as FormData;
        const payload = JSON.parse(String(body.get('payload_json')));
        expect(payload.thread_name).toBe('Play table overlaps on iPhone');
        expect(payload.applied_tags).toEqual(['1575249242828570695']);
        expect(payload.allowed_mentions).toEqual({ parse: [] });
        expect(payload.attachments).toBeUndefined();
        expect(body.get('files[0]')).toBeNull();
        expect(payload.content).toBe([
            'hey @everyone <@&42> look',
            '',
            '**Context**',
            'From: Saiem (admin-cookie)',
            'Page: <https://gameonpaper.com/nfl/game/401772510?view=preview>',
            'League: nfl, route: `/nfl/game/401772510`',
            'Viewport: 390x844',
            'User agent: Mozilla/5.0 (iPhone) Safari',
        ].join('\n'));
        expect(payload.content.length).toBeLessThanOrEqual(2000);
    });

    test('every type maps to its forum tag', async () => {
        expect(FEEDBACK_TAGS).toEqual({
            bug: '1575249232997261375', idea: '1575249236419940454', link: '1575249239720591513',
            data: '1575249242828570695', question: '1575249245953597481',
        });
        for (const [type, tag] of Object.entries(FEEDBACK_TAGS)) {
            fetchMock.mockClear();
            kv.clear();
            await post(ADMIN, form({ type }));
            expect(JSON.parse(String((fetchMock.mock.calls[0][1].body as FormData).get('payload_json'))).applied_tags).toEqual([tag]);
        }
    });

    test('an image rides as files[0], declared in attachments', async () => {
        const { res } = await post(ADMIN, form({ image: new Blob([PNG], { type: 'image/png' }) }));
        expect(res.status).toBe(200);
        const body = fetchMock.mock.calls[0][1].body as FormData;
        const payload = JSON.parse(String(body.get('payload_json')));
        expect(payload.attachments).toEqual([{ id: 0, filename: 'screenshot.png' }]);
        const file = body.get('files[0]') as File;
        expect(file.name).toBe('screenshot.png');
        expect(file.type).toBe('image/png');
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    });

    test('Discord refusing: 502, and the webhook URL is in neither the reply nor the log', async () => {
        fetchMock.mockResolvedValueOnce(new Response('{"message":"Unknown Webhook"}', { status: 404 }));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { res, json } = await post(ADMIN);
        expect(res.status).toBe(502);
        expect(JSON.stringify(json)).not.toContain('discord.com/api/webhooks');
        expect(err.mock.calls.flat().join(' ')).not.toContain('webhooks');
        fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed: ${HOOK}`));
        expect((await post(ADMIN)).res.status).toBe(502);
        expect(err.mock.calls.flat().join(' ')).not.toContain('webhooks');
        err.mockRestore();
    });
});

describe('validation', () => {
    test.each([
        ['an unknown type', { type: 'rant' }],
        ['an unknown sender', { from: 'Mallory' }],
        ['no title', { title: '   ' }],
        ['a title over 100 characters', { title: 'x'.repeat(101) }],
        ['no message', { message: '' }],
        ['a message over 1500 characters', { message: 'x'.repeat(1501) }],
    ])('%s: 400, nothing sent', async (_, over) => {
        const { res } = await post(ADMIN, form(over));
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('an image over 4 MB: 413', async () => {
        const big = new Uint8Array(4 * 1024 * 1024 + 1);
        big.set(PNG);
        const { res } = await post(ADMIN, form({ image: new Blob([big], { type: 'image/png' }) }));
        expect(res.status).toBe(413);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('a non-image, or an image whose bytes do not match its type: 415', async () => {
        expect((await post(ADMIN, form({ image: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }))).res.status).toBe(415);
        expect((await post(ADMIN, form({ image: new Blob(['MZ not a png'], { type: 'image/png' }) }))).res.status).toBe(415);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('a body declared over 5 MB is refused before it is read: 413', async () => {
        const { res } = await post(ADMIN, form(), { 'content-length': String(5 * 1024 * 1024 + 1) });
        expect(res.status).toBe(413);
    });

    test('not multipart: 415', async () => {
        const { res } = await post(ADMIN, JSON.stringify({ type: 'bug' }), { 'content-type': 'application/json' });
        expect(res.status).toBe(415);
    });
});

describe('rate limit', () => {
    test('10 per sender per 10 minutes, then 429; another sender is counted apart', async () => {
        for (let i = 0; i < 10; i++) expect((await post(ADMIN)).res.status).toBe(200);
        const { res, json } = await post(ADMIN);
        expect(res.status).toBe(429);
        expect(json.error).toContain('10 reports per 10 minutes');
        expect(fetchMock).toHaveBeenCalledTimes(10);
        expect((await post(ADMIN, form({ from: 'Jack' }))).res.status).toBe(200);
    });
});

describe('helpers', () => {
    test('webhookUrl accepts only an https Discord webhook', () => {
        expect(webhookUrl(HOOK)).toBe(HOOK);
        expect(webhookUrl(` ${HOOK}\n`)).toBe(HOOK);
        expect(webhookUrl(HOOK.replace('discord.com', 'discordapp.com'))).not.toBeNull();
        expect(webhookUrl(`${HOOK}?x=1`)).toBeNull();
        expect(webhookUrl('https://discord.com.evil.example/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz')).toBeNull();
        expect(webhookUrl(undefined)).toBeNull();
    });

    test('sniffImage reads the magic bytes', () => {
        expect(sniffImage(PNG)).toBe('image/png');
        expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
        expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
        expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
        expect(sniffImage(new TextEncoder().encode('<svg'))).toBeNull();
    });

    test('pageRoute: the league from the prefix, cfb when unprefixed, /preview dropped', () => {
        expect(pageRoute('https://gameonpaper.com/game/401856682')).toMatchObject({ league: 'cfb', route: '/game/401856682' });
        expect(pageRoute('https://gameonpaper.com/preview/wbb/team/52')).toMatchObject({ league: 'wbb', route: '/wbb/team/52' });
        expect(pageRoute('https://gameonpaper.com/nflx')).toMatchObject({ league: 'cfb', route: '/nflx' });
        expect(pageRoute('javascript:alert(1)')).toBeNull();
        expect(pageRoute('https://gameonpaper.com/x?a=b> [x](https://evil.example)')?.href).not.toContain('>');
    });

    test('a title with newlines is one thread_name line', () => {
        const p = discordPayload({ type: 'idea', title: 'a\nb\tc', message: 'm', sender: 'Jack', actor: 'admin', page: '', viewport: '', userAgent: '' });
        expect(p.thread_name).toBe('a b c');
        expect(p.content).toBe('m\n\n**Context**\nFrom: Jack (admin)');
    });
});
