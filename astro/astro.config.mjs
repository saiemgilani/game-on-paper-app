// @ts-check

import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: cloudflare(),
    integrations: [svelte()],
    redirects: {
        "/": "/cfb",
        "/trends": "/cfb/charts/trends",
        "/teams": "/cfb/teams",
        "/players": "/cfb/players",
        "/charts/[...slug]": "/cfb/charts/[...slug]",
        "/game/[...slug]": "/cfb/game/[...slug]",
        "/year/[...slug]": "/cfb/year/[...slug]",
        "/team/[...slug]": "/cfb/team/[...slug]"
    }
});