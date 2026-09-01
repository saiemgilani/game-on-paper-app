// Test stand-in for the `cloudflare:workers` virtual module. Every *_CACHE
// binding is an always-miss KV so resource modules import and run without a
// Worker runtime; nothing else on `env` is defined.
const kv = { get: async () => null, getWithMetadata: async () => ({ value: null, metadata: null }), put: async () => {}, delete: async () => {} };
export const env: Record<string, any> = new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE')) ? kv : undefined });
