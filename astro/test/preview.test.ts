import { describe, expect, test } from 'vitest';
import { mintPreviewCookie, verifyPreviewCookie, readCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { isFeatureEnabled, FLAGS } from '../src/utils/features';

describe('preview cookie', () => {
  test('round-trips with the right secret', async () => {
    const c = await mintPreviewCookie('s3cret');
    expect(await verifyPreviewCookie(c, 's3cret')).toBe(true);
  });
  test('rejects a wrong secret, tampering, and expiry', async () => {
    const c = await mintPreviewCookie('s3cret');
    expect(await verifyPreviewCookie(c, 'other')).toBe(false);
    const [v, exp, sig] = c.split('.');
    expect(await verifyPreviewCookie(`${v}.${Number(exp) + 1}.${sig}`, 's3cret')).toBe(false);
    const expired = await mintPreviewCookie('s3cret', Math.floor(Date.now() / 1000) - 100000);
    expect(await verifyPreviewCookie(expired, 's3cret')).toBe(false);
    const atBoundary = await mintPreviewCookie('s3cret');
    const boundary = Number(atBoundary.split('.')[1]);
    expect(await verifyPreviewCookie(atBoundary, 's3cret', boundary)).toBe(false); // expiry is exclusive
    expect(await verifyPreviewCookie(atBoundary, 's3cret', boundary - 1)).toBe(true);
    expect(await verifyPreviewCookie(undefined, 's3cret')).toBe(false);
    expect(await verifyPreviewCookie(c, undefined)).toBe(false);
  });
  test('readCookie parses a multi-cookie header', () => {
    expect(readCookie(`a=1; ${PREVIEW_COOKIE}=v1.2.abc; b=2`, PREVIEW_COOKIE)).toBe('v1.2.abc');
    expect(readCookie(null, PREVIEW_COOKIE)).toBe(null);
  });
});

describe('feature flags', () => {
  test('preview flags render only with locals.preview', () => {
    FLAGS['__test'] = 'preview';
    expect(isFeatureEnabled('__test', { preview: true })).toBe(true);
    expect(isFeatureEnabled('__test', { preview: false })).toBe(false);
    expect(isFeatureEnabled('__test', undefined)).toBe(false);
    FLAGS['__test'] = 'on';
    expect(isFeatureEnabled('__test', undefined)).toBe(true);
    delete FLAGS['__test'];
    expect(isFeatureEnabled('__test', { preview: true })).toBe(false);
  });
});

describe('admin session cookie', () => {
  test('round-trips, rejects tamper/expiry/other secret, and differs from the preview cookie', async () => {
    const { mintAdminCookie, verifyAdminCookie } = await import('../src/utils/adminSession');
    const { verifyPreviewCookie } = await import('../src/utils/preview');
    const c = await mintAdminCookie('s3cret');
    expect(await verifyAdminCookie(c, 's3cret')).toBe(true);
    expect(await verifyAdminCookie(c, 'other')).toBe(false);
    const [v, exp, sig] = c.split('.');
    expect(await verifyAdminCookie(`${v}.${Number(exp) + 9}.${sig}`, 's3cret')).toBe(false);
    // purpose separation: an admin cookie must not open preview mode, nor vice versa
    expect(await verifyPreviewCookie(c, 's3cret')).toBe(false);
  });
  test('timingSafeEqual compares correctly regardless of length', async () => {
    const { timingSafeEqual } = await import('../src/utils/adminSession');
    expect(await timingSafeEqual('abc', 'abc')).toBe(true);
    expect(await timingSafeEqual('abc', 'abd')).toBe(false);
    expect(await timingSafeEqual('abc', 'ab')).toBe(false);
    expect(await timingSafeEqual('', '')).toBe(true);
    expect(await timingSafeEqual('a'.repeat(200), 'a')).toBe(false);
  });
});
