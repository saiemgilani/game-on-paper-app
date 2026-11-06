// An in-memory Workers KV for tests that write: honours expirationTtl against
// Date.now(), so vi.setSystemTime can expire a key. `memEnv` stands in for the
// `cloudflare:workers` env: SESSION is this KV, every *_CACHE binding the stub's
// always-miss KV, anything else (PRO_BUCKET included) undefined.
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

export const SESSION = memKV();
const miss = { get: async () => null, getWithMetadata: async () => ({ value: null, metadata: null }), put: async () => {}, delete: async () => {} };
export const memEnv: Record<string, any> = new Proxy({ SESSION } as Record<string, any>, {
    get: (t, k) => (typeof k !== 'string' ? undefined : k in t ? t[k] : k.endsWith('_CACHE') ? miss : undefined),
});
