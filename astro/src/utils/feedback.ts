// The team's feedback inbox ('feedback-inbox'): what an admin sends from the floating
// button (components/FeedbackButton.astro) and how POST /admin/api/feedback turns it into a
// new post in the #gop-inbox Discord forum (channel 1575249116445810769), through the webhook
// in the DISCORD_INBOX_WEBHOOK_URL secret. Pure: no I/O, so test/feedback.test.ts pins it.

import { LEAGUES, PREFIXED_LEAGUES } from './league';

/** The report types, each the id of its tag in the #gop-inbox forum. */
export const FEEDBACK_TAGS = {
    bug: '1575249232997261375',
    idea: '1575249236419940454',
    link: '1575249239720591513',
    data: '1575249242828570695',
    question: '1575249245953597481',
} as const;
export type FeedbackType = keyof typeof FEEDBACK_TAGS;

/**
 * Who is sending. The admin session is one shared login with no per-person identity
 * (utils/adminSession.ts), so the sender picks their name in the sheet; an unknown name is
 * refused. ponytail: a fixed list; per-person admin logins would replace it.
 */
export const FEEDBACK_SENDERS = ['Jack', 'Akshay', 'Saiem'] as const;

export const FEEDBACK_LIMITS = {
    /** a forum post's thread_name caps at 100 */
    title: 100,
    /** leaves room for the context block inside a message's 2000 characters */
    message: 1500,
    /** what the button downscales to (<= 1600px), with headroom */
    imageBytes: 4 * 1024 * 1024,
    /** the whole multipart body: the image plus the text fields */
    bodyBytes: 5 * 1024 * 1024,
    /** posts per sender per window */
    perWindow: 10,
    windowS: 600,
} as const;

/**
 * The only URL the endpoint ever posts to is the secret's, and only when it is a Discord
 * webhook: anything else is treated as unconfigured, so a mistyped secret cannot point the
 * Worker at another host. Nothing from the request goes into the URL.
 */
const WEBHOOK_RE = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d{5,25}\/[\w-]{20,200}$/;
export function webhookUrl(raw: string | undefined | null): string | null {
    const v = (raw ?? '').trim();
    return WEBHOOK_RE.test(v) ? v : null;
}

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
export const FEEDBACK_IMAGE_TYPES = Object.keys(IMAGE_EXT);

/** The image's real type from its first bytes, or null: the declared type must match it. */
export function sniffImage(b: Uint8Array): string | null {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
    return null;
}

export function imageFilename(type: string): string {
    return `screenshot.${IMAGE_EXT[type] ?? 'bin'}`;
}

/** one line, no control characters, at most `max` characters */
function oneLine(s: string, max: number): string {
    return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Which league and route a page URL is: the league is its prefix (/nfl, /nba, ...), cfb when unprefixed. */
/** `href` is the parsed URL, re-serialized, so no raw `>` can close the <...> it is posted in. */
export function pageRoute(page: string): { league: string; route: string; href: string } | null {
    let u: URL;
    try { u = new URL(page); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const path = u.pathname.replace(/^\/preview(?=\/|$)/, '') || '/';
    const league = PREFIXED_LEAGUES.find((lg) => path === LEAGUES[lg].urlPrefix || path.startsWith(LEAGUES[lg].urlPrefix + '/')) ?? 'cfb';
    return { league, route: path, href: u.href };
}

export interface FeedbackInput {
    type: FeedbackType;
    title: string;
    message: string;
    sender: string;
    /** how the session was authenticated (locals.adminActor) */
    actor: string;
    page: string;
    viewport: string;
    userAgent: string;
    image?: { type: string } | null;
}

export type ParsedFeedback = Omit<FeedbackInput, 'actor' | 'userAgent' | 'image'>;

/** The text fields of the form, validated; an error string names the first bad one. */
export function parseFeedbackFields(get: (k: string) => unknown): ParsedFeedback | string {
    const str = (k: string) => { const v = get(k); return typeof v === 'string' ? v : ''; };
    const type = str('type') as FeedbackType;
    if (!Object.keys(FEEDBACK_TAGS).includes(type)) return `type must be one of ${Object.keys(FEEDBACK_TAGS).join(', ')}`;
    const title = oneLine(str('title'), Infinity);
    if (!title) return 'title is required';
    if (title.length > FEEDBACK_LIMITS.title) return `title must be at most ${FEEDBACK_LIMITS.title} characters`;
    const message = str('message').trim();
    if (!message) return 'message is required';
    if (message.length > FEEDBACK_LIMITS.message) return `message must be at most ${FEEDBACK_LIMITS.message} characters`;
    const sender = str('from');
    if (!(FEEDBACK_SENDERS as readonly string[]).includes(sender)) return `from must be one of ${FEEDBACK_SENDERS.join(', ')}`;
    const page = oneLine(str('page'), 300);
    const viewport = /^\d{2,5}x\d{2,5}$/.test(str('viewport')) ? str('viewport') : '';
    return { type, title, message, sender, page, viewport };
}

/**
 * The webhook's payload_json for a new forum post: thread_name is the title, the type's tag is
 * applied, and allowed_mentions parses nothing, so no text in a report can ping anyone
 * (@everyone, a role, a user). The context block rides under the message.
 */
export function discordPayload(f: FeedbackInput): Record<string, unknown> {
    const where = pageRoute(f.page);
    const context = [
        '**Context**',
        `From: ${f.sender} (${oneLine(f.actor, 40)})`,
        // <...> keeps Discord from unfurling the page into an embed
        where ? `Page: <${where.href}>` : null,
        where ? `League: ${where.league}, route: \`${oneLine(where.route, 200)}\`` : null,
        f.viewport ? `Viewport: ${f.viewport}` : null,
        f.userAgent ? `User agent: ${oneLine(f.userAgent, 250)}` : null,
    ].filter(Boolean).join('\n');
    const payload: Record<string, unknown> = {
        thread_name: oneLine(f.title, FEEDBACK_LIMITS.title),
        applied_tags: [FEEDBACK_TAGS[f.type]],
        content: `${f.message}\n\n${context}`.slice(0, 2000),
        allowed_mentions: { parse: [] },
    };
    if (f.image) payload.attachments = [{ id: 0, filename: imageFilename(f.image.type) }];
    return payload;
}

/** the KV key counting a sender's posts in the current window */
export function rateKey(sender: string, nowS: number): string {
    return `feedback-rate:${sender}:${Math.floor(nowS / FEEDBACK_LIMITS.windowS)}`;
}
