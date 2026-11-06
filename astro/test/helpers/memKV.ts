// An in-memory Workers KV for tests that write: honours expirationTtl against
// Date.now(), so vi.setSystemTime can expire a key. `memEnv` stands in for the
// `cloudflare:workers` env: SESSION is this KV, every *_CACHE binding the stub's
// always-miss KV, PRO_BUCKET an empty in-memory R2 (memR2), anything else undefined.
export function memKV() {
    const m = new Map<string, { v: string; exp?: number }>();
    const live = (k: string) => {
        const e = m.get(k);
        return e && (e.exp === undefined || e.exp > Date.now()) ? e : null;
    };
    return {
        m,
        async get(k: string, type?: string) {
            const e = live(k);
            return e ? (type === 'json' ? JSON.parse(e.v) : e.v) : null;
        },
        async put(k: string, v: string, o?: { expirationTtl?: number }) {
            m.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : undefined });
        },
        async delete(k: string) { m.delete(k); },
        async list({ prefix = '' }: { prefix?: string; cursor?: string } = {}) {
            return { keys: [...m.keys()].filter((k) => k.startsWith(prefix) && live(k)).map((name) => ({ name })), list_complete: true };
        },
        async getWithMetadata(k: string) { return { value: await this.get(k), metadata: null }; },
    };
}

/** An in-memory R2 bucket with R2's conditional put: `onlyIf.etagMatches` / `etagDoesNotMatch: '*'`
 * fail with null, as the real binding does. Set `lag` (ms) to hold every read that long, so
 * parallel callers all read before any of them writes: the race a real bucket allows. */
export function memR2() {
    const m = new Map<string, { v: string; etag: string }>();
    let n = 0;
    return {
        m,
        lag: 0,
        async get(k: string) {
            const e = m.get(k);  // read now, answer after the lag
            await new Promise((r) => setTimeout(r, this.lag));
            return e ? { etag: e.etag, json: async () => JSON.parse(e.v), text: async () => e.v, body: e.v } : null;
        },
        async put(k: string, v: string, o?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
            const cur = m.get(k);
            const c = o?.onlyIf;
            if (c?.etagMatches !== undefined && cur?.etag !== c.etagMatches) return null;
            if (c?.etagDoesNotMatch === '*' && cur) return null;
            const etag = `e${++n}`;
            m.set(k, { v, etag });
            return { key: k, etag };
        },
    };
}

export const SESSION = memKV();
export const PRO_BUCKET = memR2();
const miss = { get: async () => null, getWithMetadata: async () => ({ value: null, metadata: null }), put: async () => {}, delete: async () => {} };
export const memEnv: Record<string, any> = new Proxy({ SESSION, PRO_BUCKET } as Record<string, any>, {
    get: (t, k) => (typeof k !== 'string' ? undefined : k in t ? t[k] : k.endsWith('_CACHE') ? miss : undefined),
});
