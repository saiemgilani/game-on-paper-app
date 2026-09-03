import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';

export const prerender = false;

// What exactly is running right now: the worker's build (APP_VERSION = deploy
// SHA) and the python API's sportsdataverse-py version + sha (its /healthcheck
// is not publicly routed; this admin-authed proxy is the window to it).
export const GET: APIRoute = async () => {
    const py = getSecret('PYTHON_HTTP_URL') || 'http://python:5000';
    let python: unknown = null;
    try {
        const r = await fetch(`${py.replace(/\/$/, '')}/healthcheck`, { signal: AbortSignal.timeout(5000) });
        python = r.ok ? await r.json() : { status: `http ${r.status}` };
    } catch (e: any) {
        python = { status: `unreachable: ${e?.message ?? e}` };
    }
    return Response.json(
        { app_version: getSecret('APP_VERSION') ?? null, python },
        { headers: { 'Cache-Control': 'no-store' } },
    );
};
