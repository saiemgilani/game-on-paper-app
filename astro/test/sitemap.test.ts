import { describe, expect, test } from 'vitest';
import { GET } from '../src/pages/sitemap.xml';

const xml: string = await ((GET as any)({} as any) as Response).text();

describe('sitemap.xml', () => {
  test('is well-formed and non-trivial', () => {
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain('<urlset');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
    expect((xml.match(/<url>/g) ?? []).length).toBeGreaterThan(500);
  });

  test('every loc is an absolute gameonpaper.com URL', () => {
    for (const loc of xml.match(/<loc>([^<]+)<\/loc>/g) ?? []) {
      expect(loc).toMatch(/<loc>https:\/\/gameonpaper\.com\//);
    }
  });

  // Advertising a URL that 307s wastes exactly the crawl budget this file exists
  // to protect. These three prerender and redirect to their slashed form.
  test('prerendered routes carry their trailing slash', () => {
    for (const p of ['/teams/', '/glossary/', '/changelog/']) {
      expect(xml).toContain(`<loc>https://gameonpaper.com${p}</loc>`);
    }
    expect(xml).not.toContain('<loc>https://gameonpaper.com/teams</loc>');
    expect(xml).not.toContain('<loc>https://gameonpaper.com/glossary</loc>');
  });

  test('finished seasons are pinned to a past lastmod so Google stops re-crawling', () => {
    const m = xml.match(/<loc>https:\/\/gameonpaper\.com\/year\/2015<\/loc><lastmod>([^<]+)</);
    expect(m?.[1]).toBe('2016-01-15');
    expect(xml).toContain('<changefreq>yearly</changefreq>');
  });

  test('no doubled slashes or undefined leaked into a URL', () => {
    expect(xml).not.toMatch(/gameonpaper\.com\/\//);
    expect(xml).not.toContain('undefined');
  });
});
