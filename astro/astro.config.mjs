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
        // "/[...slug]": "/cfb/[...slug]",
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
        "/cfb/trends": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["charts"] },
        "/cfb/teams": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["leaderboards"] },
        "/cfb/players": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["leaderboards"] },
        "/cfb/charts/[...slug]": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["charts"] },
        "/cfb/year/[...slug]": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["season"] },
        "/cfb/team/[...slug]": { maxAge: 60 * 60 * 24 * 3, swr: 60 * 10, tags: ["team"] }
    },
});