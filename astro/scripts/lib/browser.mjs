// Shared browser plumbing for visual-check.mjs and walkthrough.mjs: resolve playwright-core
// without making it a repo dependency, launch the installed Chrome, and open a context that
// renders the site the way a visitor on {device, scheme} sees it.
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export async function loadChromium() {
  try { return (await import('playwright-core')).chromium; } catch {}
  const req = createRequire(import.meta.url);
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}
  roots.push(...(process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean));
  for (const base of roots) {
    try { return req(join(base, 'playwright-core')).chromium; } catch {}
  }
  console.error('playwright-core not found. Install it (it downloads no browser): `npm i -g playwright-core`, then re-run.');
  process.exit(2);
}

export function launchOptions() {
  const args = process.env.VISUAL_CHECK_NO_SANDBOX ? ['--no-sandbox'] : [];
  return process.env.VISUAL_CHECK_EXECUTABLE
    ? { executablePath: process.env.VISUAL_CHECK_EXECUTABLE, args }
    : { channel: 'chrome', args };
}

// the review matrix -- never fewer than these four per route
export const DEVICES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];
export const SCHEMES = ['light', 'dark'];

// A route's file-name stem (screenshots, clips, saved HTML, reports). A query string
// (`/players/1?season=2025`) is kept, after a `_`, so it never collides with the bare
// path; a query-free route keeps the stem it always had, so older evidence links hold.
export const slug = (r) => {
  const q = r.indexOf('?');
  const path = q < 0 ? r : r.slice(0, q);
  const stem = path === '/' ? 'home' : path.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '-');
  return q < 0 ? stem : `${stem}_${r.slice(q + 1).replace(/[^\w-]+/g, '_')}`;
};

// The stem for each route of a run. Distinct routes can slug alike (`/a-b` and `/a/b`,
// `/a?x=1` and `/a?x_1`); those get a short hash of the route appended, so neither
// overwrites the other's files. Every tool of a run builds this from the same route list.
export const slugger = (routes) => {
  const count = new Map();
  for (const r of new Set(routes)) count.set(slug(r), (count.get(slug(r)) ?? 0) + 1);
  return (r) => (count.get(slug(r)) > 1 ? `${slug(r)}_${createHash('sha1').update(r).digest('hex').slice(0, 8)}` : slug(r));
};

// What identifies a saved page: path (trailing slash ignored) plus query string, so
// `/players/1` and `/players/1?season=2025` are two pages.
export const pageKey = (url) => {
  const u = new URL(url.replace(/^\/+/, '/'), 'http://x'); // `//a/b` is a path, not a host
  return (decodeURIComponent(u.pathname).replace(/\/+$/, '') || '/') + u.search;
};

// Dark mode is driven by prefers-color-scheme (public/assets/css/dark-*.css), so emulating
// the scheme is exactly what a real dark-mode viewer hits.
export async function newThemedContext(browser, device, scheme, extra = {}) {
  return browser.newContext({
    viewport: { width: device.width, height: device.height },
    colorScheme: scheme,
    deviceScaleFactor: 2,
    ...extra,
  });
}

// Which scheme the page actually rendered under -- the media query as the page sees it.
export const appliedScheme = (page) =>
  page.evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
