/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Dummy secrets so resource modules (which read them at import via astro:env)
// load; every network call they would make is mocked in the tests.
for (const k of ['PYTHON_HTTP_TOKEN', 'SDV_AUTH_TOKEN', 'ADMIN_USER', 'ADMIN_PASS', 'GOP_INGEST_KEY']) process.env[k] ||= 'test';

// getViteConfig lets tests import .astro components (Container API). The real
// astro.config.mjs is skipped (configFile: false): its Cloudflare adapter needs
// workerd, which vitest neither has nor wants. Secrets read via astro:env are
// dummies; cloudflare:workers is aliased to a KV stub.
export default getViteConfig(
    {
        resolve: { alias: { 'cloudflare:workers': fileURLToPath(new URL('./test/stubs/cloudflare-workers.ts', import.meta.url)) } },
        test: { include: ['test/**/*.test.ts'] },
    },
    { configFile: false, output: 'server', integrations: [svelte()], trailingSlash: 'ignore' },
);
