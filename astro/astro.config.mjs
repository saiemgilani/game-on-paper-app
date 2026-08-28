// @ts-check

import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: cloudflare(),
    integrations: [svelte()],
    // Legacy /cfb/* URLs are resolved in middleware (utils/legacyCfb.ts), not
    // here. This map pointed "/cfb" and "/cfb/game" at "/index", which is not a
    // route, so the site's most-shared URL answered 404; the dynamic entries
    // resolved to "/game/<id>/index.html" and 404'd too. One prefix rule in
    // middleware covers every legacy path, including ones never enumerated here.
    redirects: {
        "/trends": "/charts/trends",
        "/players": "/year/2026/players",
    },
    trailingSlash: 'ignore',
    cache: { 
        provider: cacheCloudflare(),
    },
    routeRules: {
        "/trends": { maxAge: 60 * 60 * 24 * 3, tags: ["charts"] },
        "/teams": { maxAge: 60 * 60 * 24 * 3, tags: ["leaderboards", "favorites-enabled"] },
        "/players": { maxAge: 60 * 60 * 24 * 3, tags: ["leaderboards", "favorites-enabled"] },
        "/charts/[...slug]": { maxAge: 60 * 60 * 24 * 3, tags: ["charts", "favorites-enabled"] },
        "/year/[...slug]": { maxAge: 60 * 60 * 24 * 3, tags: ["season"] },
        "/team/[...slug]": { maxAge: 60 * 60 * 24 * 3, tags: ["team"] }
    },
});