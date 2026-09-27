// Shared browser plumbing for visual-check.mjs and walkthrough.mjs: resolve playwright-core
// without making it a repo dependency, launch the installed Chrome, and open a context that
// renders the site the way a visitor on {device, scheme} sees it.
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

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

export const slug = (r) => (r === '/' ? 'home' : r.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '-'));

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
