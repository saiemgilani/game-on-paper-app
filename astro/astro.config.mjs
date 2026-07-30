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
    redirects: {
        "/cfb": "/",
        "/cfb/[...slug]": "/[...slug]",
        // "/trends": "/cfb/charts/trends",
        // "/teams": "/cfb/teams",
        // "/players": "/cfb/players",
        // "/charts/[...slug]": "/cfb/charts/[...slug]",
        // "/game/[...slug]": "/cfb/game/[...slug]",
        // "/year/[...slug]": "/cfb/year/[...slug]",
        // "/team/[...slug]": "/cfb/team/[...slug]"
    },
    trailingSlash: 'ignore',
    cache: { 
        provider: cacheCloudflare(),
    },
    routeRules: {
        // one minute if live, one day if old -- set manually
        // "/game/[...slug]": { maxAge: 60, swr: 60 },

        // 3 days cache
        "/trends": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["charts"] },
        "/teams": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["leaderboards"] },
        "/players": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["leaderboards"] },
        "/charts/[...slug]": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["charts"] },
        "/year/[...slug]": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["season"] },
        "/team/[...slug]": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["team"] }
    },
});