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
        "/cfb": "/index",
        "/cfb/trends": "/charts/trends",
        "/cfb/teams": "/teams",
        "/cfb/players": "/players",
        "/cfb/charts": "/charts",
        "/cfb/game": "/index",
        "/cfb/year": "/teams",
        "/cfb/team": "/teams",

        "/cfb/game/[id]": "/game/[id]",
        "/cfb/team/[id]": "/team/[id]",
        "/cfb/charts/trends": "/charts/trends",

        "/cfb/year/[year]": "/year/[year]",

        "/cfb/year/[year]/players": "/year/[year]/players",
        "/cfb/year/[year]/players/[category]": "/year/[year]/players/[category]",

        "/cfb/year/[year]/teams": "/year/[year]/teams",
        "/cfb/year/[year]/teams/[category]": "/year/[year]/teams/[category]",

        "/cfb/year/[year]/[type]": "/year/[year]/[type]",
        "/cfb/year/[year]/type/[type]": "/year/[year]/type/[type]",

        "/cfb/year/[year]/team/[id]": "/year/[year]/team/[id]",

        "/trends": "/charts/trends",
        "/players": "/year/2026/players",
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